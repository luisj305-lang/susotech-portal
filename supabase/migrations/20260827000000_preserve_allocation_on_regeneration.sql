-- Regenerating the delivered PDF (office removes a photo and re-renders) must
-- not orphan the financial distribution. The money (production lines + the
-- current allocation version) is keyed to the submitted delivery, and every
-- report resolves it through jobs.current_delivery_id. Repointing
-- current_delivery_id at a submitted=false regeneration delivery made
-- is_current false everywhere and silently dropped the split from the UI,
-- office reports, weekly reports, and participant read access.
--
-- Fix: a non-submitting regeneration updates only the displayed PDF pointer
-- (delivered_pdf_path + source snapshots) and keeps current_delivery_id on the
-- submitted delivery that owns the money.

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
  selected_category public.price_categories%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform public.require_active_technician_shift(actor);
  select * into selected_job from public.jobs where id = p_job_id for update;
  perform public.require_active_technician_shift(actor);
  if selected_job.id is null or not public.can_access_job(p_job_id, actor) then raise exception 'Job unavailable'; end if;
  if public.is_technician(actor) then
    if not p_submit or selected_job.main_status not in ('asignado', 'en_revision') then raise exception 'Technicians can only submit assigned or review jobs'; end if;
  elsif public.is_admin(actor) then
    if p_submit or selected_job.main_status not in ('asignado', 'en_revision') then raise exception 'Administrators can only regenerate an editable PDF'; end if;
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
    (entry->>'quantity')::numeric, (item->>'sourcePage')::integer,
    (item->>'x')::numeric, (item->>'y')::numeric,
    (item->>'width')::numeric, (item->>'height')::numeric,
    (item->>'arrowTipX')::numeric, (item->>'arrowTipY')::numeric,
    actor, actor, event_time, event_time
  from jsonb_array_elements(draft.placements) item
  cross join lateral jsonb_array_elements(item->'entries') entry
  join public.production_code_catalog c on c.id = (entry->>'catalogId')::uuid;

  select coalesce(array_agg(a.id order by a.id), '{}'::uuid[]) into annotation_ids
  from public.job_pdf_annotations a
  where a.job_id = p_job_id and a.draft_version = draft.version and a.created_at = event_time;
  update public.job_deliveries set source_annotation_ids = annotation_ids where id = new_delivery;

  if p_submit then
    select * into selected_category from public.price_categories pc
    where pc.id = actor_profile.price_category_id and pc.active;
    if selected_category.id is null then
      raise exception 'Technician price category is not configured';
    end if;
    if exists (
      select 1
      from public.job_pdf_annotations a
      where a.id = any(annotation_ids)
        and not exists (
          select 1
          from public.production_code_rates r
          where r.catalog_item_id = a.catalog_id
            and r.price_category_id = selected_category.id
            and r.active
            and r.effective_from <= (now() at time zone 'America/New_York')::date
        )
    ) then raise exception 'Production code has no configured rate for technician category'; end if;

    insert into public.job_delivery_production_lines (
      delivery_id, job_id, source_annotation_id, credited_technician_id,
      code, quantity, technician_type_snapshot, unit_snapshot,
      unit_rate_snapshot, amount_snapshot, credited_at
    )
    select new_delivery, p_job_id, a.id, actor, a.code_snapshot, a.quantity,
      case selected_category.slug when 'inhouse' then 'in_house'
        when 'subcontractor' then 'contractor' else null end,
      c.unit, rate.unit_price, round(a.quantity * rate.unit_price, 2), event_time
    from public.job_pdf_annotations a
    join public.production_code_catalog c on c.id = a.catalog_id
    join lateral (
      select r.unit_price
      from public.production_code_rates r
      where r.catalog_item_id = a.catalog_id
        and r.price_category_id = selected_category.id
        and r.active
        and r.effective_from <= (now() at time zone 'America/New_York')::date
      order by r.effective_from desc, r.created_at desc, r.id desc
      limit 1
    ) rate on true
    where a.id = any(annotation_ids);
  end if;

  perform set_config('app.delivered_pdf_confirmation', actor::text, true);
  update public.jobs
  set delivered_pdf_path = p_storage_path,
      delivered_pdf_generated_at = event_time,
      delivered_pdf_generated_by = actor,
      delivered_pdf_source_photo_ids = current_photo_ids,
      delivered_pdf_source_document_ids = current_document_ids,
      current_delivery_id = case when p_submit then new_delivery else previous_delivery end,
      main_status = case when p_submit then 'en_revision'::public.job_status else main_status end
  where id = p_job_id;

  insert into public.job_pdf_delivery_versions(job_id, draft_version, delivered_path, confirmed_at)
  values(p_job_id, draft.version, p_storage_path, event_time)
  on conflict(job_id) do update set draft_version = excluded.draft_version,
    delivered_path = excluded.delivered_path, confirmed_at = excluded.confirmed_at;

  return query select selected_job.delivered_pdf_path,
    case when p_submit then 'en_revision'::public.job_status else selected_job.main_status end,
    new_delivery;
end;
$$;
