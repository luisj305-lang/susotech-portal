-- Multiple production codes per PDF placement. A placement box now carries an
-- ordered "entries" array (catalogId + quantity each) instead of a single code.
-- Billing expands one production line per entry; geometry, arrow and color stay
-- per-box. Old single-code drafts are migrated on the client and re-saved.

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
  entry jsonb;
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
    or selected_job.main_status not in ('asignado', 'en_revision') or selected_job.archived_at is not null
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
      or not (item ?& array['id','entries','page','sourceDocumentId','sourcePage','x','y','width','height','arrowTipX','arrowTipY'])
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'sourceDocumentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'page')::numeric <> trunc((item->>'page')::numeric)
      or (item->>'sourcePage')::numeric <> trunc((item->>'sourcePage')::numeric)
      or jsonb_typeof(item->'entries') <> 'array'
      or jsonb_array_length(item->'entries') < 1
      or jsonb_array_length(item->'entries') > 20
      or (item->>'x')::numeric < 0 or (item->>'y')::numeric < 0
      or (item->>'width')::numeric not between 0.04 and 0.35
      or (item->>'height')::numeric not between 0.025 and 0.20
      or (item->>'x')::numeric + (item->>'width')::numeric > 1
      or (item->>'y')::numeric + (item->>'height')::numeric > 1
      or (item->>'arrowTipX')::numeric not between 0 and 1
      or (item->>'arrowTipY')::numeric not between 0 and 1
    then raise exception 'Invalid placement'; end if;

    for entry in select value from jsonb_array_elements(item->'entries') loop
      if jsonb_typeof(entry) <> 'object'
        or not (entry ?& array['catalogId','quantity'])
        or (select count(*) from jsonb_object_keys(entry) as entry_keys(entry_key)
          where entry_key not in ('catalogId','quantity')) <> 0
        or (entry->>'catalogId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or (entry->>'quantity')::numeric <= 0
        or (entry->>'quantity')::numeric <> round((entry->>'quantity')::numeric, 2)
      then raise exception 'Invalid placement entry'; end if;

      select c.unit into item_unit from public.production_code_catalog c
      where c.id = (entry->>'catalogId')::uuid and c.is_active;
      if item_unit is null or (item_unit in ('fixed', 'event')
        and (entry->>'quantity')::numeric <> trunc((entry->>'quantity')::numeric))
      then raise exception 'Invalid placement quantity'; end if;
    end loop;

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
      current_delivery_id = new_delivery,
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
