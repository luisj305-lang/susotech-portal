-- Supervisors gain the same photo/evidence/document management powers as
-- admins, minus price and user administration. Status gates are preserved
-- exactly; only the is_admin -> is_office_staff boundary flips.

-- ---------------------------------------------------------------------------
-- 1. Office-side evidence photo insert.
-- ---------------------------------------------------------------------------

drop policy if exists "Authorized users can add job evidence" on public.job_photos;
create policy "Authorized users can add job evidence"
on public.job_photos for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.job_id_from_storage_path(storage_path) = job_id
  and exists (
    select 1 from public.jobs j
    where j.id = job_id
      and j.main_status in ('asignado', 'en_revision')
      and j.archived_at is null
  )
  and (
    public.is_office_staff(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(job_id)
    )
  )
);

-- ---------------------------------------------------------------------------
-- 2. Office-side evidence object upload and retry.
-- ---------------------------------------------------------------------------

drop policy if exists "Authorized users upload editable job evidence" on storage.objects;
create policy "Authorized users upload editable job evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-evidence'
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('asignado', 'en_revision')
      and j.archived_at is null
  )
  and (
    public.is_office_staff(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(public.job_id_from_storage_path(name))
    )
  )
);

drop policy if exists "Authorized users update editable job evidence" on storage.objects;
create policy "Authorized users update editable job evidence"
on storage.objects for update to authenticated
using (
  bucket_id = 'job-evidence'
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('asignado', 'en_revision')
      and j.archived_at is null
  )
  and (
    public.is_office_staff(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(public.job_id_from_storage_path(name))
    )
  )
)
with check (
  bucket_id = 'job-evidence'
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('asignado', 'en_revision')
      and j.archived_at is null
  )
  and (
    public.is_office_staff(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(public.job_id_from_storage_path(name))
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3. Audited photo deletion guard.
-- ---------------------------------------------------------------------------

create or replace function public.delete_job_photo_audited(p_photo_id uuid)
returns table(queue_id bigint, job_id uuid, bucket_id text, object_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  photo public.job_photos%rowtype;
  selected_job public.jobs%rowtype;
  cleanup_id bigint;
begin
  select * into photo from public.job_photos where id = p_photo_id for update;
  if photo.id is null then raise exception 'Photo unavailable'; end if;
  select * into selected_job from public.jobs where id = photo.job_id for update;
  if not public.is_office_staff(actor) and not (
    public.is_operational_worker(actor)
    and public.can_mutate_job(photo.job_id, actor)
    and selected_job.main_status in ('asignado', 'en_revision')
    and selected_job.archived_at is null
  ) then raise exception 'Photo deletion unavailable'; end if;

  if photo.deleted_at is null then
    insert into public.job_deletion_cleanup_queue(job_id, bucket_id, object_name, requested_by)
    values(photo.job_id, 'job-evidence', photo.storage_path, actor)
    on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key
    do update set job_id = excluded.job_id, requested_by = excluded.requested_by,
      last_error = null
    returning id into cleanup_id;

    update public.job_photos
    set deleted_at = clock_timestamp(), deleted_by = actor
    where id = photo.id;

    insert into public.job_photo_deletion_events(
      job_id, photo_id, storage_path, uploaded_by, uploaded_at,
      deleted_by, deleted_at
    ) values (
      photo.job_id, photo.id, photo.storage_path, photo.uploaded_by,
      photo.created_at, actor, clock_timestamp()
    );
  else
    select q.id into cleanup_id
    from public.job_deletion_cleanup_queue q
    where q.bucket_id = 'job-evidence' and q.object_name = photo.storage_path;
  end if;

  return query select cleanup_id, photo.job_id, 'job-evidence'::text, photo.storage_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Additional-document RPC gates.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_job_document_v2(
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
  new_id uuid := gen_random_uuid();
  clean_name text := nullif(btrim(p_display_name), '');
  new_path text;
  new_position integer;
begin
  if not public.is_office_staff(actor) then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then raise exception 'Job unavailable'; end if;
  if clean_name is null or char_length(clean_name) > 255
    or clean_name !~* '[.]pdf$' or p_mime_type <> 'application/pdf'
    or p_size_bytes is null or p_size_bytes not between 1 and 26214400
    or p_file_hash !~ '^[a-f0-9]{64}$'
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
    file_hash, verification_status
  ) values (
    new_id, p_job_id, left(clean_name, 255), left(clean_name, 255),
    new_path, p_mime_type, p_size_bytes, 'pending', actor, 'additional',
    new_position, p_file_hash, 'pending'
  );
  return query select new_id, new_path;
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
  if not public.is_office_staff(actor) then raise exception 'Admin access required'; end if;
  select * into document from public.job_documents where id = p_document_id for update;
  if document.id is null then raise exception 'Document unavailable'; end if;
  if document.document_type <> 'additional' then raise exception 'The original document cannot be removed through this operation'; end if;
  if exists (
    select 1 from public.job_deliveries d
    where p_document_id = any(d.source_document_ids)
  ) or exists (
    select 1 from public.job_pdf_drafts draft,
      jsonb_array_elements(draft.placements) placement
    where draft.job_id = document.job_id
      and placement ->> 'sourceDocumentId' = p_document_id::text
  ) then raise exception 'A source document already used by the editor or a delivery cannot be removed'; end if;

  if document.deleted_at is null then
    if exists (
      select 1 from storage.objects o
      where o.bucket_id = 'project-files' and o.name = document.storage_path
    ) then
      insert into public.job_deletion_cleanup_queue(job_id, bucket_id, object_name, requested_by)
      values(document.job_id, 'project-files', document.storage_path, actor)
      on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key
      do update set job_id = excluded.job_id, requested_by = excluded.requested_by, last_error = null;
    end if;
    update public.job_documents
    set deleted_at = clock_timestamp(), deleted_by = actor
    where id = document.id;
  end if;
  return query select q.id, q.bucket_id, q.object_name
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
  if not public.is_office_staff(actor) then raise exception 'Admin access required'; end if;
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

-- Confirming an uploaded additional attachment (pdf_verified) is part of the
-- document-management surface. This RPC only ever confirms document_type =
-- 'additional'; the original replacement is confirmed by a separate
-- admin-only RPC (confirm_job_original_replacement).
create or replace function public.confirm_job_document_verified(
  p_document_id uuid,
  p_file_hash text,
  p_page_count integer
)
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
  if not public.is_office_staff(actor) then raise exception 'Admin access required'; end if;
  select * into document from public.job_documents where id = p_document_id for update;
  if document.id is null or document.deleted_at is not null or document.document_type <> 'additional'
    or p_file_hash !~ '^[a-f0-9]{64}$' or p_file_hash is distinct from document.file_hash
    or p_page_count not between 1 and 100
  then raise exception 'Document unavailable'; end if;

  select lower(coalesce(o.metadata->>'mimetype', '')),
         coalesce((o.metadata->>'size')::bigint, 0)
  into stored_mime, stored_size
  from storage.objects o
  where o.bucket_id = 'project-files' and o.name = document.storage_path;
  if stored_mime <> document.mime_type or stored_size <> document.size_bytes then
    raise exception 'Stored PDF does not match prepared metadata';
  end if;

  update public.job_documents
  set status = 'active', confirmed_at = coalesce(confirmed_at, clock_timestamp()),
      page_count = p_page_count, verification_status = 'pdf_verified',
      verified_at = clock_timestamp()
  where id = document.id;
end;
$$;
