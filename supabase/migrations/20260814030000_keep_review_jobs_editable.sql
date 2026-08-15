-- Jobs remain technician-editable through review. Approval and archival are the hard boundaries.
-- Hardened validation, locking, lineage and audit behavior remain unchanged.

create or replace function public.initialize_job_pdf_draft_v2_before_capabilities(
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
    or selected_job.main_status not in ('en_progreso', 'enviado_revision') or selected_job.archived_at is not null
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

create or replace function public.save_job_pdf_draft_v2_before_capabilities(
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
    or selected_job.main_status not in ('en_progreso', 'enviado_revision') or selected_job.archived_at is not null
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

create or replace function public.confirm_delivered_job_pdf_complete_before_capabilities(
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
    if not p_submit or selected_job.main_status not in ('en_progreso', 'enviado_revision') then raise exception 'Technicians can only submit jobs in progress or review'; end if;
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

-- Jobs remain technician-editable through review. Approval and archival are
-- the hard boundaries. The hardened draft/delivery definitions are prepended
-- below with only their status predicate widened.

-- Evidence can be added while the job is in progress or under review.
drop policy if exists "Technicians can add photos to assigned jobs" on public.job_photos;
create policy "Technicians can add photos to assigned jobs"
on public.job_photos for insert to authenticated
with check (
  public.is_operational_worker(auth.uid())
  and uploaded_by = auth.uid()
  and public.can_mutate_job(job_id)
  and public.job_id_from_storage_path(storage_path) = job_id
  and exists (
    select 1 from public.jobs j
    where j.id = job_id
      and j.main_status in ('en_progreso', 'enviado_revision')
  )
);

drop policy if exists "Operational workers upload assigned evidence" on storage.objects;
create policy "Operational workers upload assigned evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'job-evidence'
  and public.is_operational_worker(auth.uid())
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('en_progreso', 'enviado_revision')
  )
);

drop policy if exists "Operational workers update assigned evidence" on storage.objects;
create policy "Operational workers update assigned evidence"
on storage.objects for update to authenticated
using (
  bucket_id = 'job-evidence'
  and public.is_operational_worker(auth.uid())
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('en_progreso', 'enviado_revision')
  )
)
with check (
  bucket_id = 'job-evidence'
  and public.is_operational_worker(auth.uid())
  and public.can_mutate_job(public.job_id_from_storage_path(name))
  and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_storage_path(name)
      and j.main_status in ('en_progreso', 'enviado_revision')
  )
);

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
  if not public.is_admin(actor) and not (
    public.is_operational_worker(actor)
    and public.can_mutate_job(photo.job_id, actor)
    and selected_job.main_status in ('en_progreso', 'enviado_revision')
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

