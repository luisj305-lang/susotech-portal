-- Multiple audited PDF attachments while preserving the special original and
-- delivered document slots on public.jobs.

create table public.job_documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  status text not null default 'pending' check (status in ('pending', 'active')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint job_documents_storage_path_check check (
    storage_path = job_id::text || '/attachments/' || id::text || '.pdf'
  )
);

create index job_documents_job_created_idx
  on public.job_documents (job_id, created_at desc)
  where status = 'active';

alter table public.job_documents enable row level security;

create policy "Authorized users view active job documents"
on public.job_documents for select to authenticated
using (status = 'active' and public.can_access_job(job_id));

revoke insert, update, delete on public.job_documents from authenticated;
grant select on public.job_documents to authenticated;

create or replace function public.is_referenced_project_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.jobs j
    where j.project_pdf_url = object_name or j.delivered_pdf_path = object_name
  ) or exists (
    select 1 from public.job_documents d where d.storage_path = object_name
  );
$$;

drop policy if exists "Office staff can upload project files" on storage.objects;
create policy "Office staff can upload project files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and (
    public.is_admin()
    or name !~ '^[0-9a-f-]{36}/attachments/'
  )
);

drop policy if exists "Office staff can update project files" on storage.objects;
create policy "Office staff can update project files"
on storage.objects for update to authenticated
using (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and (public.is_admin() or name !~ '^[0-9a-f-]{36}/attachments/')
)
with check (
  bucket_id = 'project-files'
  and public.is_office_staff()
  and (public.is_admin() or name !~ '^[0-9a-f-]{36}/attachments/')
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
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then raise exception 'Job unavailable'; end if;
  if clean_name is null or char_length(clean_name) > 255
    or clean_name !~* '[.]pdf$'
    or p_mime_type <> 'application/pdf'
    or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 26214400
  then raise exception 'Invalid PDF metadata'; end if;

  new_path := p_job_id::text || '/attachments/' || new_id::text || '.pdf';
  insert into public.job_documents (
    id, job_id, display_name, storage_path, mime_type, size_bytes, uploaded_by
  ) values (
    new_id, p_job_id, left(clean_name, 255), new_path, p_mime_type, p_size_bytes, actor
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
  set status = 'active', confirmed_at = now()
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
  select * into document from public.job_documents where id = p_document_id for update;
  if document.id is null then raise exception 'Document unavailable'; end if;

  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files' and o.name = document.storage_path
  ) then
    insert into public.job_deletion_cleanup_queue (
      job_id, bucket_id, object_name, requested_by
    ) values (
      document.job_id, 'project-files', document.storage_path, actor
    )
    on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key do update
      set job_id = excluded.job_id,
          requested_by = excluded.requested_by,
          last_error = null;
  end if;

  delete from public.job_documents where id = document.id;

  return query
  select q.id, q.bucket_id, q.object_name
  from public.job_deletion_cleanup_queue q
  where q.bucket_id = 'project-files' and q.object_name = document.storage_path;
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
  if not exists (select 1 from public.jobs where id = p_job_id) then raise exception 'Job unavailable'; end if;

  for document in
    select * from public.job_documents
    where job_id = p_job_id and status = 'pending'
      and created_at < now() - interval '15 minutes'
    for update
  loop
    stored_mime := null;
    stored_size := null;
    select lower(coalesce(o.metadata->>'mimetype', '')),
           coalesce((o.metadata->>'size')::bigint, 0)
      into stored_mime, stored_size
    from storage.objects o
    where o.bucket_id = 'project-files' and o.name = document.storage_path;

    if stored_mime = document.mime_type and stored_size = document.size_bytes then
      update public.job_documents set status = 'active', confirmed_at = now()
      where id = document.id;
      activated := activated + 1;
    else
      if stored_mime is not null then
        insert into public.job_deletion_cleanup_queue (
          job_id, bucket_id, object_name, requested_by
        ) values (
          document.job_id, 'project-files', document.storage_path, actor
        )
        on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key do update
          set job_id = excluded.job_id,
              requested_by = excluded.requested_by,
              last_error = null;
        queued := queued + 1;
      end if;
      delete from public.job_documents where id = document.id;
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
