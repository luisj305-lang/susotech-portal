-- Allow an administrator to replace a deleted original PDF without turning it
-- into an additional attachment. Confirmation is the atomic trust boundary.

drop index if exists public.job_documents_job_position_idx;
create unique index job_documents_job_position_idx
  on public.job_documents (job_id, position)
  where status = 'active' and deleted_at is null;

drop index if exists public.job_documents_one_original_idx;
create unique index job_documents_one_original_idx
  on public.job_documents (job_id)
  where document_type = 'original' and status = 'active' and deleted_at is null;

create unique index if not exists job_documents_one_pending_original_idx
  on public.job_documents (job_id)
  where document_type = 'original' and status = 'pending' and deleted_at is null;

create or replace function public.prepare_job_original_replacement(
  p_job_id uuid,
  p_display_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_file_hash text
)
returns table(document_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  new_id uuid := gen_random_uuid();
  clean_name text := nullif(btrim(p_display_name), '');
  new_path text;
  pending public.job_documents%rowtype;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('job-original:' || p_job_id::text, 0)
  );
  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null then raise exception 'Job unavailable'; end if;
  if selected_job.project_pdf_url is not null then
    raise exception 'Delete the current original PDF before uploading its replacement';
  end if;
  if clean_name is null or char_length(clean_name) > 255
    or clean_name !~* '[.]pdf$' or p_mime_type <> 'application/pdf'
    or p_size_bytes is null or p_size_bytes not between 1 and 26214400
    or p_file_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'Invalid PDF metadata'; end if;
  select * into pending from public.job_documents d
  where d.job_id = p_job_id and d.document_type = 'original'
    and d.status = 'pending' and d.deleted_at is null
  for update;
  if pending.id is not null then
    if exists (
      select 1 from storage.objects o
      where o.bucket_id = 'project-files' and o.name = pending.storage_path
    ) then
      insert into public.job_deletion_cleanup_queue(job_id, bucket_id, object_name, requested_by)
      values(p_job_id, 'project-files', pending.storage_path, actor)
      on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key
      do update set job_id = excluded.job_id, requested_by = excluded.requested_by,
        last_error = null;
    end if;
    update public.job_documents
    set deleted_at = clock_timestamp(), deleted_by = actor
    where id = pending.id;
  end if;

  new_path := p_job_id::text || '/originals/' || new_id::text || '.pdf';
  insert into public.job_documents (
    id, job_id, display_name, original_filename, storage_path, mime_type,
    size_bytes, status, uploaded_by, document_type, position,
    file_hash, verification_status
  ) values (
    new_id, p_job_id, left(clean_name, 255), left(clean_name, 255),
    new_path, p_mime_type, p_size_bytes, 'pending', actor, 'original', 0,
    p_file_hash, 'pending'
  );
  return query select new_id, new_path;
end;
$$;

create or replace function public.confirm_job_original_replacement(
  p_document_id uuid,
  p_file_hash text,
  p_page_count integer
)
returns table(document_id uuid, storage_path text, source_document_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  document public.job_documents%rowtype;
  document_job_id uuid;
  selected_job public.jobs%rowtype;
  stored_mime text;
  stored_size bigint;
  manifest_ids uuid[];
  manifest_pages integer;
begin
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
  select d.job_id into document_job_id
  from public.job_documents d where d.id = p_document_id;
  if document_job_id is null then raise exception 'Original replacement unavailable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('job-original:' || document_job_id::text, 0)
  );
  select * into document from public.job_documents where id = p_document_id for update;
  if document.id is null or document.deleted_at is not null
    or document.document_type <> 'original' or document.status <> 'pending'
    or document.verification_status <> 'pending'
    or p_file_hash !~ '^[a-f0-9]{64}$' or p_file_hash is distinct from document.file_hash
    or p_page_count not between 1 and 100
  then raise exception 'Original replacement unavailable'; end if;

  select * into selected_job from public.jobs where id = document.job_id for update;
  if selected_job.id is null or selected_job.project_pdf_url is not null then
    raise exception 'Original PDF reference changed';
  end if;

  select lower(coalesce(o.metadata ->> 'mimetype', '')),
         coalesce((o.metadata ->> 'size')::bigint, 0)
  into stored_mime, stored_size
  from storage.objects o
  where o.bucket_id = 'project-files' and o.name = document.storage_path;
  if stored_mime <> 'application/pdf' or stored_size <> document.size_bytes then
    raise exception 'Stored PDF does not match prepared metadata';
  end if;

  update public.job_documents
  set deleted_at = clock_timestamp(), deleted_by = actor
  where job_id = document.job_id and document_type = 'original'
    and status = 'active' and deleted_at is null and id <> document.id;

  update public.job_documents
  set status = 'active', confirmed_at = clock_timestamp(),
      page_count = p_page_count, verification_status = 'pdf_verified',
      verified_at = clock_timestamp()
  where id = document.id;

  update public.jobs
  set project_pdf_url = document.storage_path
  where id = document.job_id and project_pdf_url is null;
  if not found then raise exception 'Original PDF reference changed'; end if;

  select array_agg(d.id order by d.position, d.created_at, d.id),
         sum(d.page_count)::integer
  into manifest_ids, manifest_pages
  from public.job_documents d
  where d.job_id = document.job_id and d.status = 'active'
    and d.deleted_at is null and d.verification_status = 'pdf_verified'
    and d.page_count is not null;
  if manifest_ids is null or manifest_ids[1] is distinct from document.id
    or manifest_pages not between 1 and 100
  then raise exception 'Verified PDF source manifest is invalid'; end if;

  update public.job_pdf_drafts
  set source_page_count = manifest_pages,
      source_document_ids = manifest_ids,
      placements = '[]'::jsonb,
      text_notes = '[]'::jsonb,
      version = version + 1,
      updated_by = actor,
      updated_at = clock_timestamp()
  where job_id = document.job_id;

  return query select document.id, document.storage_path, manifest_ids;
end;
$$;

create or replace function public.discard_job_original_replacement(p_document_id uuid)
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
  if document.id is null then return; end if;
  if document.document_type <> 'original' then raise exception 'Original replacement unavailable'; end if;
  if document.status = 'active' or document.deleted_at is not null then return; end if;
  if document.status <> 'pending' then raise exception 'Original replacement unavailable'; end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files' and o.name = document.storage_path
  ) then
    insert into public.job_deletion_cleanup_queue(job_id, bucket_id, object_name, requested_by)
    values(document.job_id, 'project-files', document.storage_path, actor)
    on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key
    do update set job_id = excluded.job_id, requested_by = excluded.requested_by,
      last_error = null;
  end if;
  update public.job_documents
  set deleted_at = clock_timestamp(), deleted_by = actor
  where id = document.id;
  return query select q.id, q.bucket_id, q.object_name
  from public.job_deletion_cleanup_queue q
  where q.bucket_id = 'project-files' and q.object_name = document.storage_path;
end;
$$;

revoke all on function public.prepare_job_original_replacement(uuid, text, text, bigint, text) from public;
revoke all on function public.confirm_job_original_replacement(uuid, text, integer) from public;
revoke all on function public.discard_job_original_replacement(uuid) from public;
grant execute on function public.prepare_job_original_replacement(uuid, text, text, bigint, text) to authenticated;
grant execute on function public.confirm_job_original_replacement(uuid, text, integer) to authenticated;
grant execute on function public.discard_job_original_replacement(uuid) to authenticated;
