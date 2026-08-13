-- Extend the existing additional-document collection without replacing the
-- compatibility pointer in jobs.project_pdf_url or inventing missing metadata.

alter table public.job_documents
  add column if not exists document_type text not null default 'additional',
  add column if not exists original_filename text,
  add column if not exists file_hash text,
  add column if not exists position integer,
  add column if not exists page_count integer,
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verified_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

update public.job_documents
set original_filename = display_name
where original_filename is null;

with ordered as (
  select id,
    row_number() over (partition by job_id order by created_at, id)::integer as next_position
  from public.job_documents
  where position is null
)
update public.job_documents d
set position = ordered.next_position
from ordered
where d.id = ordered.id;

-- Existing active attachments already passed MIME/size confirmation. Hash and
-- page count remain NULL until real bytes are verified by a later server flow.
update public.job_documents
set verification_status = 'metadata_verified',
    verified_at = coalesce(verified_at, confirmed_at)
where status = 'active' and verification_status = 'pending';

alter table public.job_documents
  alter column original_filename set not null,
  alter column position set not null;

alter table public.job_documents drop constraint if exists job_documents_document_type_check;
alter table public.job_documents add constraint job_documents_document_type_check
  check (document_type in ('original', 'additional'));
alter table public.job_documents drop constraint if exists job_documents_storage_path_check;
alter table public.job_documents add constraint job_documents_storage_path_check check (
  (
    document_type = 'additional'
    and storage_path = job_id::text || '/attachments/' || id::text || '.pdf'
  ) or (
    document_type = 'original'
    and storage_path like job_id::text || '/%'
    and storage_path !~ ('^' || job_id::text || '/(attachments|delivered)/')
    and storage_path ~* '[.]pdf$'
  )
);
alter table public.job_documents drop constraint if exists job_documents_original_filename_check;
alter table public.job_documents add constraint job_documents_original_filename_check
  check (char_length(btrim(original_filename)) between 1 and 255);
alter table public.job_documents drop constraint if exists job_documents_file_hash_check;
alter table public.job_documents add constraint job_documents_file_hash_check
  check (file_hash is null or file_hash ~ '^[a-f0-9]{64}$');
alter table public.job_documents drop constraint if exists job_documents_position_check;
alter table public.job_documents add constraint job_documents_position_check check (
  (document_type = 'original' and position = 0)
  or (document_type = 'additional' and position >= 1)
);
alter table public.job_documents drop constraint if exists job_documents_page_count_check;
alter table public.job_documents add constraint job_documents_page_count_check
  check (page_count is null or page_count between 1 and 500);
alter table public.job_documents drop constraint if exists job_documents_verification_status_check;
alter table public.job_documents add constraint job_documents_verification_status_check
  check (verification_status in ('pending', 'metadata_verified', 'pdf_verified', 'failed'));

-- Backfill only originals whose historic import audit contains every required
-- value. Other legacy originals remain on jobs.project_pdf_url until a server
-- reconciliation computes their real metadata; no values are fabricated.
insert into public.job_documents (
  job_id, display_name, original_filename, storage_path, mime_type,
  size_bytes, status, uploaded_by, created_at, confirmed_at,
  document_type, position, file_hash, verification_status, verified_at
)
select j.id, left(btrim(i.source_file_name), 255),
  left(btrim(i.source_file_name), 255), j.project_pdf_url,
  'application/pdf', i.source_file_size, 'active', i.imported_by,
  i.imported_at, i.imported_at, 'original', 0,
  i.source_file_hash, 'metadata_verified', i.imported_at
from public.jobs j
join public.job_imports i on i.job_id = j.id
where j.project_pdf_url is not null
  and j.project_pdf_url ~* '[.]pdf$'
  and split_part(j.project_pdf_url, '/', 1) = j.id::text
  and i.source_file_size between 1 and 26214400
  and not exists (
    select 1 from public.job_documents d
    where d.job_id = j.id and d.document_type = 'original'
  );

create unique index if not exists job_documents_job_position_idx
  on public.job_documents (job_id, position);
create unique index if not exists job_documents_job_id_id_idx
  on public.job_documents (job_id, id);
create unique index if not exists job_documents_one_original_idx
  on public.job_documents (job_id)
  where document_type = 'original';
create index if not exists job_documents_active_order_idx
  on public.job_documents (job_id, position, created_at, id)
  where status = 'active' and deleted_at is null;

alter table public.job_documents
  drop constraint if exists job_documents_soft_delete_pair_check;
alter table public.job_documents add constraint job_documents_soft_delete_pair_check
  check (
    (deleted_at is null and deleted_by is null)
    or (deleted_at is not null and deleted_by is not null)
  );

drop policy if exists "Authorized users view active job documents"
on public.job_documents;
create policy "Authorized users view active job documents"
on public.job_documents for select to authenticated
using (
  status = 'active'
  and deleted_at is null
  and public.can_access_job(job_id)
);

create or replace function public.prepare_job_document(
  p_job_id uuid,
  p_display_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns table(document_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  new_id uuid := gen_random_uuid();
  clean_name text := nullif(btrim(p_display_name), '');
  new_path text;
  new_position integer;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then raise exception 'Job unavailable'; end if;
  if clean_name is null or char_length(clean_name) > 255
    or clean_name !~* '[.]pdf$'
    or p_mime_type <> 'application/pdf'
    or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 26214400
  then raise exception 'Invalid PDF metadata'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('job-documents:' || p_job_id::text, 0)
  );
  select coalesce(max(d.position), 0) + 1 into new_position
  from public.job_documents d where d.job_id = p_job_id;

  new_path := p_job_id::text || '/attachments/' || new_id::text || '.pdf';
  insert into public.job_documents (
    id, job_id, display_name, original_filename, storage_path, mime_type,
    size_bytes, status, uploaded_by, document_type, position,
    verification_status
  ) values (
    new_id, p_job_id, left(clean_name, 255), left(clean_name, 255), new_path,
    p_mime_type, p_size_bytes, 'pending', actor, 'additional', new_position,
    'pending'
  );
  return query select new_id, new_path;
end;
$$;

create or replace function public.confirm_job_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document public.job_documents%rowtype;
  stored_mime text;
  stored_size bigint;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  select * into document from public.job_documents where id = p_document_id for update;
  if document.id is null then raise exception 'Document unavailable'; end if;
  if document.deleted_at is not null then raise exception 'Document unavailable'; end if;
  if document.document_type <> 'additional' then raise exception 'Only additional documents use this confirmation flow'; end if;
  if document.status = 'active' then return; end if;

  select lower(coalesce(o.metadata->>'mimetype', '')),
         coalesce((o.metadata->>'size')::bigint, 0)
    into stored_mime, stored_size
  from storage.objects o
  where o.bucket_id = 'project-files' and o.name = document.storage_path;

  if stored_mime <> document.mime_type or stored_size <> document.size_bytes then
    raise exception 'Stored PDF does not match prepared metadata';
  end if;

  update public.job_documents
  set status = 'active',
      confirmed_at = now(),
      verification_status = 'metadata_verified',
      verified_at = now()
  where id = document.id;
end;
$$;

create or replace function public.delete_job_document(p_document_id uuid)
returns table(queue_id bigint, bucket_id text, object_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document public.job_documents%rowtype;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  select * into document
  from public.job_documents
  where id = p_document_id
  for update;
  if document.id is null then raise exception 'Document unavailable'; end if;
  if document.document_type <> 'additional' then
    raise exception 'The original document cannot be removed through this operation';
  end if;

  if document.deleted_at is null then
    if exists (
      select 1 from storage.objects o
      where o.bucket_id = 'project-files' and o.name = document.storage_path
    ) then
      insert into public.job_deletion_cleanup_queue (
        job_id, bucket_id, object_name, requested_by
      ) values (
        document.job_id, 'project-files', document.storage_path, actor
      )
      on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key
      do update set job_id = excluded.job_id,
        requested_by = excluded.requested_by,
        last_error = null;
    end if;

    update public.job_documents
    set deleted_at = now(), deleted_by = actor
    where id = document.id;
  end if;

  return query
  select q.id, q.bucket_id, q.object_name
  from public.job_deletion_cleanup_queue q
  where q.bucket_id = 'project-files'
    and q.object_name = document.storage_path;
end;
$$;

create or replace function public.reconcile_job_documents(p_job_id uuid)
returns table(activated_count integer, discarded_count integer, queued_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document public.job_documents%rowtype;
  stored_mime text;
  stored_size bigint;
  activated integer := 0;
  discarded integer := 0;
  queued integer := 0;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'Job unavailable';
  end if;

  for document in
    select *
    from public.job_documents
    where job_id = p_job_id
      and document_type = 'additional'
      and status = 'pending'
      and deleted_at is null
      and created_at < now() - interval '15 minutes'
    for update
  loop
    stored_mime := null;
    stored_size := null;

    select lower(coalesce(o.metadata->>'mimetype', '')),
           coalesce((o.metadata->>'size')::bigint, 0)
      into stored_mime, stored_size
    from storage.objects o
    where o.bucket_id = 'project-files'
      and o.name = document.storage_path;

    if stored_mime = document.mime_type and stored_size = document.size_bytes then
      update public.job_documents
      set status = 'active',
          confirmed_at = now(),
          verification_status = 'metadata_verified',
          verified_at = now()
      where id = document.id;
      activated := activated + 1;
    else
      if stored_mime is not null then
        insert into public.job_deletion_cleanup_queue (
          job_id, bucket_id, object_name, requested_by
        ) values (
          document.job_id, 'project-files', document.storage_path, actor
        )
        on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key
        do update set job_id = excluded.job_id,
          requested_by = excluded.requested_by,
          last_error = null;
        queued := queued + 1;
      end if;

      update public.job_documents
      set deleted_at = now(),
          deleted_by = actor,
          verification_status = 'failed'
      where id = document.id;
      discarded := discarded + 1;
    end if;
  end loop;

  return query select activated, discarded, queued;
end;
$$;

revoke all on function public.prepare_job_document(uuid, text, text, bigint) from public;
revoke all on function public.confirm_job_document(uuid) from public;
revoke all on function public.delete_job_document(uuid) from public;
revoke all on function public.reconcile_job_documents(uuid) from public;
grant execute on function public.prepare_job_document(uuid, text, text, bigint) to authenticated;
grant execute on function public.confirm_job_document(uuid) to authenticated;
grant execute on function public.delete_job_document(uuid) to authenticated;
grant execute on function public.reconcile_job_documents(uuid) to authenticated;
