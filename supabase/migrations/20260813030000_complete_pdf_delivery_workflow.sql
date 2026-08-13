-- Connect the Phase 1 document, annotation and delivery primitives to the
-- versioned editor and final-delivery transaction.

create extension if not exists pgcrypto with schema extensions;

alter table public.job_documents alter column uploaded_by drop not null;
alter table public.job_documents drop constraint if exists job_documents_uploader_check;
alter table public.job_documents add constraint job_documents_uploader_check check (
  document_type = 'original' or uploaded_by is not null
);

alter table public.job_pdf_drafts
  add column if not exists source_document_ids uuid[] not null default '{}'::uuid[];

alter table public.jobs
  add column if not exists current_delivery_id uuid,
  add column if not exists delivered_pdf_source_document_ids uuid[] not null default '{}'::uuid[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_current_delivery_fk'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs add constraint jobs_current_delivery_fk
      foreign key (current_delivery_id) references public.job_deliveries(id) on delete restrict;
  end if;
end $$;

-- Migration backfills run without auth.uid(); pause the authorization trigger
-- under the DDL lock and restore it before any concurrent write can proceed.
alter table public.jobs disable trigger validate_job_before_update;
update public.jobs j
set current_delivery_id = d.id,
    delivered_pdf_source_document_ids = d.source_document_ids
from public.job_deliveries d
where j.delivered_pdf_path = d.storage_path
  and j.current_delivery_id is null;
alter table public.jobs enable trigger validate_job_before_update;

-- Preserve legacy production rows without fabricating PDF annotation geometry.
-- New deliveries always use source_annotation_id; historical deliveries may
-- instead point at the immutable ID of the old production row.
alter table public.job_delivery_production_lines
  alter column source_annotation_id drop not null,
  alter column quantity type numeric using quantity::numeric,
  add column if not exists legacy_production_code_id uuid;

alter table public.job_delivery_production_lines
  drop constraint if exists job_delivery_production_lines_lineage_check;
alter table public.job_delivery_production_lines
  add constraint job_delivery_production_lines_lineage_check check (
    (source_annotation_id is not null) <> (legacy_production_code_id is not null)
  );

create unique index if not exists job_delivery_production_legacy_line_idx
  on public.job_delivery_production_lines (delivery_id, legacy_production_code_id)
  where legacy_production_code_id is not null;

create or replace function public.validate_delivery_production_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.job_deliveries d
    where d.id = new.delivery_id and d.job_id = new.job_id
  ) then
    raise exception 'Delivery production lineage is invalid';
  end if;

  if new.source_annotation_id is not null then
    if not exists (
      select 1 from public.job_pdf_annotations a
      where a.id = new.source_annotation_id and a.job_id = new.job_id
    ) then
      raise exception 'Delivery production annotation lineage is invalid';
    end if;
  elsif not exists (
    select 1 from public.job_production_codes pc
    where pc.id = new.legacy_production_code_id and pc.job_id = new.job_id
  ) or not exists (
    select 1 from public.job_deliveries d
    where d.id = new.delivery_id and d.delivery_kind = 'legacy'
  ) then
    raise exception 'Delivery production legacy lineage is invalid';
  end if;
  return new;
end;
$$;

-- A legacy PDF generator may be office staff. The auditable transition into
-- enviado_revision is the trustworthy source for the technician who made the
-- final submission, so use it when it exists and is a technician.
with final_submitter as (
  select d.id as delivery_id, h.changed_by
  from public.job_deliveries d
  join lateral (
    select sh.changed_by
    from public.job_status_history sh
    join public.profiles p on p.id = sh.changed_by and p.role = 'tecnico'
    where sh.job_id = d.job_id and sh.new_status = 'enviado_revision'
    order by sh.created_at desc, sh.id desc
    limit 1
  ) h on true
  where d.delivery_kind = 'legacy' and d.submitted and d.superseded_at is null
)
update public.job_deliveries d
set delivered_by = f.changed_by
from final_submitter f
where d.id = f.delivery_id;

insert into public.job_delivery_production_lines (
  delivery_id, job_id, source_annotation_id, legacy_production_code_id,
  credited_technician_id, code, quantity, technician_type_snapshot,
  unit_snapshot, unit_rate_snapshot, amount_snapshot, credited_at
)
select d.id, d.job_id, null, pc.id, d.delivered_by, pc.code, pc.quantity,
  coalesce(pc.technician_type_snapshot, p.technician_type),
  pc.unit_snapshot, pc.unit_rate_snapshot, pc.amount_snapshot, d.confirmed_at
from public.job_deliveries d
join public.profiles p
  on p.id = d.delivered_by and p.role = 'tecnico'
join public.job_production_codes pc on pc.job_id = d.job_id
where d.delivery_kind = 'legacy'
  and d.submitted
  and d.superseded_at is null
on conflict do nothing;

create or replace function public.validate_job_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  status_changed boolean := old.main_status is distinct from new.main_status;
  incident_changed boolean := old.incident is distinct from new.incident;
  delivered_changed boolean :=
    old.delivered_pdf_path is distinct from new.delivered_pdf_path
    or old.delivered_pdf_generated_at is distinct from new.delivered_pdf_generated_at
    or old.delivered_pdf_generated_by is distinct from new.delivered_pdf_generated_by
    or old.delivered_pdf_source_photo_ids is distinct from new.delivered_pdf_source_photo_ids
    or old.delivered_pdf_source_document_ids is distinct from new.delivered_pdf_source_document_ids
    or old.current_delivery_id is distinct from new.current_delivery_id;
  delivered_confirmation boolean := coalesce(
    current_setting('app.delivered_pdf_confirmation', true) = auth.uid()::text,
    false
  );
  delivered_deletion boolean := coalesce(
    current_setting('app.job_pdf_deletion', true) = coalesce(auth.uid()::text, auth.role()),
    false
  );
begin
  if status_changed and incident_changed then raise exception 'Status and incident must be changed separately'; end if;
  if delivered_changed and not (delivered_confirmation or delivered_deletion) then
    raise exception 'Delivered PDF metadata must be changed atomically';
  end if;
  if delivered_deletion then
    if status_changed or incident_changed then raise exception 'PDF deletion cannot change job workflow'; end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;

  if public.is_office_staff(auth.uid()) then
    if status_changed and not (
      (old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')
      or (old.main_status = 'enviado_revision' and new.main_status in ('aprobado', 'en_progreso'))
      or (old.main_status = 'aprobado' and new.main_status = 'listo_pagar')
      or (old.main_status = 'listo_pagar' and new.main_status = 'pagado')
    ) then raise exception 'Office status transition is not allowed'; end if;
    if old.main_status = 'enviado_revision' and new.main_status = 'en_progreso'
      and nullif(btrim(new.comments), '') is null then
      raise exception 'Returning a job to progress requires a reason';
    end if;
  else
    if not public.is_technician() or not public.can_access_job(old.id) then raise exception 'Job update not authorized'; end if;
    if (to_jsonb(new) - array[
        'main_status','incident','incident_notes','comments','updated_at',
        'delivered_pdf_path','delivered_pdf_generated_at','delivered_pdf_generated_by',
        'delivered_pdf_source_photo_ids','delivered_pdf_source_document_ids','current_delivery_id'
      ]) is distinct from (to_jsonb(old) - array[
        'main_status','incident','incident_notes','comments','updated_at',
        'delivered_pdf_path','delivered_pdf_generated_at','delivered_pdf_generated_by',
        'delivered_pdf_source_photo_ids','delivered_pdf_source_document_ids','current_delivery_id'
      ]) then raise exception 'Technicians cannot update office-managed fields'; end if;
    if delivered_changed and not (
      delivered_confirmation and old.main_status = 'en_progreso'
      and new.main_status = 'enviado_revision'
    ) then raise exception 'Technician delivered PDF update is not allowed'; end if;
    if status_changed and not (
      (old.main_status = 'asignado' and new.main_status = 'en_progreso')
      or (old.main_status = 'en_progreso' and new.main_status = 'enviado_revision')
    ) then raise exception 'Technician status transition is not allowed'; end if;
  end if;
  if status_changed and new.main_status = 'enviado_revision' then new.submitted_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'aprobado' then new.approved_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'pagado' then new.paid_at := clock_timestamp(); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Backfill original document rows only when the private Storage object provides
-- real metadata. Unknown legacy uploaders remain NULL instead of being invented.
insert into public.job_documents (
  job_id, display_name, original_filename, storage_path, mime_type,
  size_bytes, status, uploaded_by, created_at, confirmed_at,
  document_type, position, verification_status, verified_at
)
select j.id,
  left(regexp_replace(j.project_pdf_url, '^.*/', ''), 255),
  left(regexp_replace(j.project_pdf_url, '^.*/', ''), 255),
  j.project_pdf_url, 'application/pdf', (o.metadata ->> 'size')::bigint,
  'active', i.imported_by, coalesce(i.imported_at, j.created_at),
  coalesce(i.imported_at, j.created_at), 'original', 0,
  'metadata_verified', coalesce(i.imported_at, j.created_at)
from public.jobs j
join storage.objects o
  on o.bucket_id = 'project-files' and o.name = j.project_pdf_url
left join lateral (
  select ji.imported_by, ji.imported_at
  from public.job_imports ji
  where ji.job_id = j.id
  order by ji.imported_at
  limit 1
) i on true
where j.project_pdf_url is not null
  and lower(coalesce(o.metadata ->> 'mimetype', '')) = 'application/pdf'
  and (o.metadata ->> 'size')::bigint between 1 and 26214400
  and not exists (
    select 1 from public.job_documents d
    where d.job_id = j.id and d.document_type = 'original'
  )
on conflict do nothing;

create or replace function public.ensure_job_original_document(
  p_job_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_size_bytes bigint,
  p_file_hash text,
  p_page_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_job public.jobs%rowtype;
  existing_id uuid;
  new_id uuid := gen_random_uuid();
  stored_size bigint;
  stored_mime text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service access required';
  end if;
  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null or selected_job.project_pdf_url is distinct from p_storage_path
    or p_original_filename is null or char_length(btrim(p_original_filename)) not between 1 and 255
    or p_size_bytes not between 1 and 26214400
    or p_file_hash !~ '^[a-f0-9]{64}$'
    or p_page_count not between 1 and 100
  then raise exception 'Invalid original document'; end if;

  select nullif(o.metadata ->> 'size', '')::bigint,
         lower(o.metadata ->> 'mimetype')
  into stored_size, stored_mime
  from storage.objects o
  where o.bucket_id = 'project-files' and o.name = p_storage_path;
  if stored_size is distinct from p_size_bytes or stored_mime is distinct from 'application/pdf' then
    raise exception 'Stored PDF does not match verified metadata';
  end if;

  select d.id into existing_id
  from public.job_documents d
  where d.job_id = p_job_id and d.document_type = 'original'
  for update;

  if existing_id is null then
    insert into public.job_documents (
      id, job_id, display_name, original_filename, storage_path, mime_type,
      size_bytes, status, uploaded_by, confirmed_at, document_type, position,
      file_hash, page_count, verification_status, verified_at
    ) values (
      new_id, p_job_id, left(btrim(p_original_filename), 255),
      left(btrim(p_original_filename), 255), p_storage_path, 'application/pdf',
      p_size_bytes, 'active', null, clock_timestamp(), 'original', 0,
      p_file_hash, p_page_count, 'pdf_verified', clock_timestamp()
    );
    return new_id;
  end if;

  update public.job_documents
  set storage_path = p_storage_path,
      display_name = left(btrim(p_original_filename), 255),
      original_filename = left(btrim(p_original_filename), 255),
      size_bytes = p_size_bytes,
      status = 'active', deleted_at = null, deleted_by = null,
      file_hash = p_file_hash, page_count = p_page_count,
      verification_status = 'pdf_verified', verified_at = clock_timestamp(),
      confirmed_at = coalesce(confirmed_at, clock_timestamp())
  where id = existing_id;
  return existing_id;
end;
$$;

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
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
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
  if not public.is_admin(actor) then raise exception 'Admin access required'; end if;
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

create or replace function public.verify_job_document_as_service(
  p_document_id uuid,
  p_file_hash text,
  p_page_count integer,
  p_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  document public.job_documents%rowtype;
  stored_mime text;
  stored_size bigint;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service access required';
  end if;
  select * into document from public.job_documents where id = p_document_id for update;
  if document.id is null or document.deleted_at is not null or document.status <> 'active'
    or p_file_hash !~ '^[a-f0-9]{64}$' or p_page_count not between 1 and 100
    or p_size_bytes is distinct from document.size_bytes
  then raise exception 'Document unavailable'; end if;
  select lower(coalesce(o.metadata->>'mimetype', '')),
         coalesce((o.metadata->>'size')::bigint, 0)
  into stored_mime, stored_size
  from storage.objects o
  where o.bucket_id = 'project-files' and o.name = document.storage_path;
  if stored_mime <> 'application/pdf' or stored_size <> p_size_bytes then
    raise exception 'Stored PDF does not match verified metadata';
  end if;
  update public.job_documents
  set file_hash = p_file_hash, page_count = p_page_count,
      verification_status = 'pdf_verified', verified_at = clock_timestamp()
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

create or replace function public.initialize_job_pdf_draft_v2(
  p_job_id uuid,
  p_source_document_ids uuid[],
  p_page_count integer
)
returns table(version integer, source_page_count integer, placements jsonb, source_document_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  current_document_ids uuid[];
begin
  if not public.is_technician(actor) then raise exception 'Job unavailable'; end if;
  perform public.require_active_technician_shift(actor);
  select * into selected_job from public.jobs where id = p_job_id for update;
  perform public.require_active_technician_shift(actor);
  if selected_job.id is null or not public.can_access_job(p_job_id, actor)
    or selected_job.main_status <> 'en_progreso' or selected_job.archived_at is not null
  then raise exception 'Job is not editable'; end if;

  select coalesce(array_agg(d.id order by d.position, d.created_at, d.id), '{}'::uuid[])
  into current_document_ids
  from public.job_documents d
  where d.job_id = p_job_id and d.status = 'active' and d.deleted_at is null
    and d.verification_status = 'pdf_verified' and d.page_count is not null;
  if cardinality(current_document_ids) = 0
    or current_document_ids is distinct from coalesce(p_source_document_ids, '{}'::uuid[])
    or p_page_count is distinct from (
      select sum(d.page_count)::integer from public.job_documents d
      where d.id = any(current_document_ids)
    )
    or p_page_count not between 1 and 100
  then raise exception 'PDF source manifest changed'; end if;

  insert into public.job_pdf_drafts(job_id, source_page_count, source_document_ids, updated_by)
  values(p_job_id, p_page_count, current_document_ids, actor)
  on conflict(job_id) do update set
    source_page_count = excluded.source_page_count,
    source_document_ids = excluded.source_document_ids,
    version = case
      when job_pdf_drafts.source_document_ids is distinct from excluded.source_document_ids
        or job_pdf_drafts.source_page_count is distinct from excluded.source_page_count
      then job_pdf_drafts.version + 1 else job_pdf_drafts.version end,
    updated_by = actor,
    updated_at = case
      when job_pdf_drafts.source_document_ids is distinct from excluded.source_document_ids
        or job_pdf_drafts.source_page_count is distinct from excluded.source_page_count
      then clock_timestamp() else job_pdf_drafts.updated_at end;

  return query select d.version, d.source_page_count, d.placements, d.source_document_ids
  from public.job_pdf_drafts d where d.job_id = p_job_id;
end;
$$;

create or replace function public.save_job_pdf_draft_v2(
  p_job_id uuid,
  p_expected_version integer,
  p_placements jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  draft public.job_pdf_drafts%rowtype;
  current_document_ids uuid[];
  item jsonb;
  other_item jsonb;
  item_unit text;
  expected_page integer;
  result_version integer;
begin
  if not public.is_technician(actor) then raise exception 'Job unavailable'; end if;
  perform public.require_active_technician_shift(actor);
  select * into selected_job from public.jobs where id = p_job_id for update;
  perform public.require_active_technician_shift(actor);
  if selected_job.id is null or not public.can_access_job(p_job_id, actor)
    or selected_job.main_status <> 'en_progreso' or selected_job.archived_at is not null
  then raise exception 'Job is not editable'; end if;

  select * into draft from public.job_pdf_drafts where job_id = p_job_id for update;
  perform public.require_active_technician_shift(actor);
  if draft.job_id is null then raise exception 'Draft unavailable'; end if;
  if draft.version <> p_expected_version then raise exception 'Draft version conflict'; end if;

  select coalesce(array_agg(d.id order by d.position, d.created_at, d.id), '{}'::uuid[])
  into current_document_ids
  from public.job_documents d
  where d.job_id = p_job_id and d.status = 'active' and d.deleted_at is null
    and d.verification_status = 'pdf_verified' and d.page_count is not null;
  if current_document_ids is distinct from draft.source_document_ids then
    raise exception 'PDF source manifest changed';
  end if;
  if jsonb_typeof(p_placements) <> 'array' or jsonb_array_length(p_placements) > 500 then
    raise exception 'Invalid placements';
  end if;

  for item in select value from jsonb_array_elements(p_placements) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['id','catalogId','page','sourceDocumentId','sourcePage','quantity','x','y','width','height','arrowTipX','arrowTipY'])
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'catalogId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'sourceDocumentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'page')::numeric <> trunc((item->>'page')::numeric)
      or (item->>'sourcePage')::numeric <> trunc((item->>'sourcePage')::numeric)
      or (item->>'quantity')::numeric <= 0
      or (item->>'quantity')::numeric <> round((item->>'quantity')::numeric, 2)
      or (item->>'x')::numeric < 0 or (item->>'y')::numeric < 0
      or (item->>'width')::numeric not between 0.04 and 0.35
      or (item->>'height')::numeric not between 0.025 and 0.20
      or (item->>'x')::numeric + (item->>'width')::numeric > 1
      or (item->>'y')::numeric + (item->>'height')::numeric > 1
      or (item->>'arrowTipX')::numeric not between 0 and 1
      or (item->>'arrowTipY')::numeric not between 0 and 1
    then raise exception 'Invalid placement'; end if;

    select c.unit into item_unit from public.production_code_catalog c
    where c.id = (item->>'catalogId')::uuid and c.is_active;
    if item_unit is null or (item_unit in ('fixed', 'event')
      and (item->>'quantity')::numeric <> trunc((item->>'quantity')::numeric))
    then raise exception 'Invalid placement quantity'; end if;

    select coalesce(sum(previous.page_count), 0)::integer + (item->>'sourcePage')::integer
    into expected_page
    from public.job_documents selected
    left join public.job_documents previous
      on previous.job_id = selected.job_id and previous.status = 'active'
      and previous.deleted_at is null and previous.position < selected.position
    where selected.id = (item->>'sourceDocumentId')::uuid
      and selected.job_id = p_job_id and selected.status = 'active'
      and selected.deleted_at is null and selected.page_count is not null
      and (item->>'sourcePage')::integer between 1 and selected.page_count
    group by selected.id;
    if expected_page is null or expected_page <> (item->>'page')::integer then
      raise exception 'Invalid placement page lineage';
    end if;

    for other_item in select value from jsonb_array_elements(p_placements)
      where value->>'id' < item->>'id' and (value->>'page')::integer = (item->>'page')::integer
    loop
      if (item->>'x')::numeric < (other_item->>'x')::numeric + (other_item->>'width')::numeric
        and (item->>'x')::numeric + (item->>'width')::numeric > (other_item->>'x')::numeric
        and (item->>'y')::numeric < (other_item->>'y')::numeric + (other_item->>'height')::numeric
        and (item->>'y')::numeric + (item->>'height')::numeric > (other_item->>'y')::numeric
      then raise exception 'Placements overlap'; end if;
    end loop;
  end loop;

  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_placements)) then
    raise exception 'Duplicate placement id';
  end if;
  perform public.require_active_technician_shift(actor);
  update public.job_pdf_drafts
  set placements = p_placements, version = version + 1,
      updated_by = actor, updated_at = clock_timestamp()
  where job_id = p_job_id returning version into result_version;
  return result_version;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid placement';
end;
$$;

create or replace function public.confirm_delivered_job_pdf_complete(
  p_job_id uuid,
  p_storage_path text,
  p_source_photo_ids uuid[],
  p_source_document_ids uuid[],
  p_submit boolean,
  p_expected_draft_version integer,
  p_snapshot_hash text
)
returns table(previous_storage_path text, delivered_status public.job_status, delivery_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  draft public.job_pdf_drafts%rowtype;
  current_photo_ids uuid[];
  current_document_ids uuid[];
  supplied_photo_ids uuid[];
  stored_size bigint;
  stored_mime text;
  stored_generator text;
  stored_job_id text;
  stored_photo_ids text;
  stored_document_ids text;
  stored_snapshot_hash text;
  calculated_snapshot_hash text;
  event_time timestamptz := clock_timestamp();
  previous_delivery uuid;
  new_delivery uuid := gen_random_uuid();
  annotation_ids uuid[];
  actor_profile public.profiles%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform public.require_active_technician_shift(actor);
  select * into selected_job from public.jobs where id = p_job_id for update;
  perform public.require_active_technician_shift(actor);
  if selected_job.id is null or not public.can_access_job(p_job_id, actor) then raise exception 'Job unavailable'; end if;
  if public.is_technician(actor) then
    if not p_submit or selected_job.main_status <> 'en_progreso' then raise exception 'Technicians can only submit jobs in progress'; end if;
  elsif public.is_admin(actor) then
    if p_submit or selected_job.main_status not in ('en_progreso', 'enviado_revision') then raise exception 'Administrators can only regenerate an editable PDF'; end if;
  else raise exception 'Delivered PDF confirmation is not authorized'; end if;

  select * into draft from public.job_pdf_drafts where job_id = p_job_id for update;
  if draft.job_id is null or draft.version <> p_expected_draft_version then raise exception 'Draft version conflict'; end if;
  if p_submit and jsonb_array_length(draft.placements) = 0 then raise exception 'At least one production annotation is required'; end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[]) into current_photo_ids
  from public.job_photos p where p.job_id = p_job_id and p.deleted_at is null;
  select coalesce(array_agg(value order by value), '{}'::uuid[]) into supplied_photo_ids
  from unnest(coalesce(p_source_photo_ids, '{}'::uuid[])) supplied(value);
  if cardinality(current_photo_ids) = 0 then raise exception 'At least one confirmed evidence photo is required'; end if;
  if current_photo_ids is distinct from supplied_photo_ids then raise exception 'Evidence changed while the delivered PDF was generated'; end if;

  select coalesce(array_agg(d.id order by d.position, d.created_at, d.id), '{}'::uuid[])
  into current_document_ids
  from public.job_documents d
  where d.job_id = p_job_id and d.status = 'active' and d.deleted_at is null
    and d.verification_status = 'pdf_verified' and d.page_count is not null and d.file_hash is not null;
  if cardinality(current_document_ids) = 0
    or current_document_ids is distinct from coalesce(p_source_document_ids, '{}'::uuid[])
    or current_document_ids is distinct from draft.source_document_ids
  then raise exception 'PDF sources changed while the delivered PDF was generated'; end if;

  if p_snapshot_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Annotation snapshot changed while the delivered PDF was generated';
  end if;
  calculated_snapshot_hash := p_snapshot_hash;

  select nullif(o.metadata ->> 'size', '')::bigint,
    lower(o.metadata ->> 'mimetype'), o.user_metadata ->> 'generator',
    o.user_metadata ->> 'job_id', o.user_metadata ->> 'source_photo_ids',
    o.user_metadata ->> 'source_document_ids', o.user_metadata ->> 'snapshot_hash'
  into stored_size, stored_mime, stored_generator, stored_job_id,
    stored_photo_ids, stored_document_ids, stored_snapshot_hash
  from storage.objects o where o.bucket_id = 'project-files' and o.name = p_storage_path;
  if p_storage_path !~ ('^' || p_job_id::text || '/delivered/[0-9a-f-]{36}[.]pdf$')
    or stored_size is null or stored_size not between 1 and 104857600
    or stored_mime is distinct from 'application/pdf'
    or stored_generator is distinct from 'susotech-portal'
    or stored_job_id is distinct from p_job_id::text
    or stored_photo_ids is distinct from array_to_string(current_photo_ids, ',')
    or stored_document_ids is distinct from array_to_string(current_document_ids, ',')
    or stored_snapshot_hash is distinct from calculated_snapshot_hash
  then raise exception 'Delivered PDF object is missing or invalid'; end if;

  select * into actor_profile from public.profiles where id = actor;
  previous_delivery := selected_job.current_delivery_id;
  if p_submit then
    update public.job_deliveries set superseded_at = event_time
    where job_id = p_job_id and submitted and superseded_at is null;
  end if;

  insert into public.job_deliveries (
    id, job_id, storage_path, delivery_kind, draft_version,
    source_document_ids, source_photo_ids, annotation_snapshot, snapshot_hash,
    delivered_by, replaces_delivery_id, submitted, created_at, confirmed_at
  ) values (
    new_delivery, p_job_id, p_storage_path,
    case when p_submit then 'submission' else 'regeneration' end,
    draft.version, current_document_ids, current_photo_ids, draft.placements,
    calculated_snapshot_hash, actor, previous_delivery, p_submit, event_time, event_time
  );

  insert into public.job_pdf_annotations (
    id, job_id, draft_version, source_document_id, catalog_id, code_snapshot,
    quantity, source_page, box_x, box_y, box_width, box_height,
    arrow_tip_x, arrow_tip_y, created_by, updated_by, created_at, updated_at
  )
  select gen_random_uuid(), p_job_id, draft.version,
    (item->>'sourceDocumentId')::uuid, c.id, c.code,
    (item->>'quantity')::numeric, (item->>'sourcePage')::integer,
    (item->>'x')::numeric, (item->>'y')::numeric,
    (item->>'width')::numeric, (item->>'height')::numeric,
    (item->>'arrowTipX')::numeric, (item->>'arrowTipY')::numeric,
    actor, actor, event_time, event_time
  from jsonb_array_elements(draft.placements) item
  join public.production_code_catalog c on c.id = (item->>'catalogId')::uuid;

  select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]) into annotation_ids
  from public.job_pdf_annotations a
  where a.job_id = p_job_id and a.draft_version = draft.version and a.created_at = event_time;
  update public.job_deliveries set source_annotation_ids = annotation_ids where id = new_delivery;

  if p_submit then
    insert into public.job_delivery_production_lines (
      delivery_id, job_id, source_annotation_id, credited_technician_id,
      code, quantity, technician_type_snapshot, unit_snapshot,
      unit_rate_snapshot, amount_snapshot, credited_at
    )
    select new_delivery, p_job_id, a.id, actor, a.code_snapshot, a.quantity,
      actor_profile.technician_type, c.unit,
      case actor_profile.technician_type when 'contractor' then c.contractor_rate else c.in_house_rate end,
      round(a.quantity * (case actor_profile.technician_type when 'contractor' then c.contractor_rate else c.in_house_rate end), 2),
      event_time
    from public.job_pdf_annotations a
    join public.production_code_catalog c on c.id = a.catalog_id
    where a.id = any(annotation_ids);
  end if;

  perform set_config('app.delivered_pdf_confirmation', actor::text, true);
  update public.jobs
  set delivered_pdf_path = p_storage_path,
      delivered_pdf_generated_at = event_time,
      delivered_pdf_generated_by = actor,
      delivered_pdf_source_photo_ids = current_photo_ids,
      delivered_pdf_source_document_ids = current_document_ids,
      current_delivery_id = new_delivery,
      main_status = case when p_submit then 'enviado_revision'::public.job_status else main_status end
  where id = p_job_id;

  insert into public.job_pdf_delivery_versions(job_id, draft_version, delivered_path, confirmed_at)
  values(p_job_id, draft.version, p_storage_path, event_time)
  on conflict(job_id) do update set draft_version = excluded.draft_version,
    delivered_path = excluded.delivered_path, confirmed_at = excluded.confirmed_at;

  return query select selected_job.delivered_pdf_path,
    case when p_submit then 'enviado_revision'::public.job_status else selected_job.main_status end,
    new_delivery;
end;
$$;

create or replace function public.supersede_rejected_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.main_status = 'enviado_revision' and new.main_status = 'en_progreso' then
    update public.job_deliveries
    set superseded_at = coalesce(superseded_at, clock_timestamp())
    where job_id = new.id and submitted and superseded_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists supersede_rejected_submission_after_update on public.jobs;
create trigger supersede_rejected_submission_after_update
after update of main_status on public.jobs
for each row execute function public.supersede_rejected_submission();

revoke all on function public.ensure_job_original_document(uuid, text, text, bigint, text, integer) from public;
revoke all on function public.prepare_job_document_v2(uuid, text, text, bigint, text) from public;
revoke all on function public.confirm_job_document_verified(uuid, text, integer) from public;
revoke all on function public.verify_job_document_as_service(uuid, text, integer, bigint) from public;
revoke all on function public.delete_job_document(uuid) from public;
revoke all on function public.initialize_job_pdf_draft_v2(uuid, uuid[], integer) from public;
revoke all on function public.save_job_pdf_draft_v2(uuid, integer, jsonb) from public;
revoke all on function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text) from public;
revoke all on function public.supersede_rejected_submission() from public;

-- Legacy mutation entrypoints remain available during the expansion deployment
-- so the currently running portal keeps working until the v2 application is
-- live. A follow-up contract migration revokes them after the rollout.

grant execute on function public.ensure_job_original_document(uuid, text, text, bigint, text, integer) to service_role;
grant execute on function public.prepare_job_document_v2(uuid, text, text, bigint, text) to authenticated;
grant execute on function public.confirm_job_document_verified(uuid, text, integer) to authenticated;
grant execute on function public.verify_job_document_as_service(uuid, text, integer, bigint) to service_role;
grant execute on function public.delete_job_document(uuid) to authenticated;
grant execute on function public.initialize_job_pdf_draft_v2(uuid, uuid[], integer) to authenticated;
grant execute on function public.save_job_pdf_draft_v2(uuid, integer, jsonb) to authenticated;
grant execute on function public.confirm_delivered_job_pdf_complete(uuid, text, uuid[], uuid[], boolean, integer, text) to authenticated;
grant execute on function public.has_active_technician_shift(uuid) to service_role;
grant execute on function public.can_access_job(uuid, uuid) to service_role;
