-- Job invoicing and splits: state machine, production gates, billing state,
-- supervisor job permissions and category-filtered catalog. All definitions
-- replace the currently applied versions with identical signatures; applied
-- migrations are never modified.

-- ---------------------------------------------------------------------------
-- 1. State machine: sin_asignar -> asignado -> en_revision -> aprobado ->
--    facturado -> pagado. Technicians deliver only through the delivery RPC.
-- ---------------------------------------------------------------------------

create or replace function public.validate_job_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    current_setting('app.delivered_pdf_confirmation', true) = auth.uid()::text, false
  );
  delivered_deletion boolean := coalesce(
    current_setting('app.job_pdf_deletion', true) = coalesce(auth.uid()::text, auth.role()), false
  );
  assignment_transition boolean := status_changed
    and old.main_status in ('sin_asignar', 'asignado')
    and new.main_status in ('sin_asignar', 'asignado')
    and current_setting('app.job_assignment_mutation', true) = coalesce(auth.uid()::text, 'migration');
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
  if assignment_transition then
    null;
  elsif public.is_office_staff(auth.uid()) then
    if status_changed and not (
      (old.main_status = 'asignado' and new.main_status = 'en_revision')
      or (old.main_status = 'en_revision' and new.main_status in ('aprobado', 'asignado'))
      or (old.main_status = 'aprobado' and new.main_status = 'facturado')
      or (old.main_status = 'facturado' and new.main_status = 'pagado')
    ) then raise exception 'Office status transition is not allowed'; end if;
    if old.main_status = 'en_revision' and new.main_status = 'asignado'
      and nullif(btrim(new.comments), '') is null
    then raise exception 'Returning a job for correction requires a reason'; end if;
    if old.main_status = 'aprobado' and new.main_status = 'facturado'
      and nullif(btrim(new.invoice_number), '') is null
    then raise exception 'Invoicing a job requires an invoice number'; end if;
  else
    if not public.can_mutate_job(old.id) then raise exception 'Job update not authorized'; end if;
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
      delivered_confirmation and old.main_status in ('asignado', 'en_revision')
      and new.main_status = 'en_revision'
    ) then raise exception 'Technician delivered PDF update is not allowed'; end if;
    if status_changed and not (
      delivered_confirmation and old.main_status = 'asignado' and new.main_status = 'en_revision'
    ) then raise exception 'Technician status transition is not allowed'; end if;
  end if;

  if new.main_status = 'pagado' and (
    new.invoice_number is distinct from old.invoice_number
    or new.invoice_path is distinct from old.invoice_path
  ) then raise exception 'Invoice details are immutable after payment'; end if;

  if status_changed and new.main_status = 'en_revision' then new.submitted_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'aprobado' then new.approved_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'facturado' then new.invoiced_at := clock_timestamp(); end if;
  if status_changed and new.main_status = 'pagado' then new.paid_at := clock_timestamp(); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Production gates: asignado is execution; en_revision stays editable for
--    corrections. Applies to the production RPC, the delivered-PDF RPCs and
--    the evidence/photo RLS boundaries.
-- ---------------------------------------------------------------------------

create or replace function public.add_job_production_before_capabilities(
  p_job_id uuid,
  p_catalog_id uuid,
  p_quantity numeric,
  p_production_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_profile public.profiles%rowtype;
  catalog public.production_code_catalog%rowtype;
  selected_category public.price_categories%rowtype;
  selected_rate numeric(12,3);
  selected_job public.jobs%rowtype;
  result_id uuid;
begin
  select * into actor_profile from public.profiles
  where id = actor and is_active and role = 'tecnico';
  if actor_profile.id is null then raise exception 'Active technician required'; end if;
  perform public.require_active_technician_shift(actor);
  if p_quantity is null
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity')
    or p_quantity <= 0
  then raise exception 'Quantity must be a finite positive number'; end if;
  if p_production_date is not null
    and p_production_date <> (now() at time zone 'America/New_York')::date
  then raise exception 'Technicians cannot backdate production'; end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  perform public.require_active_technician_shift(actor);
  if selected_job.id is null or not public.can_access_job(p_job_id, actor)
  then raise exception 'Job unavailable'; end if;
  if selected_job.main_status not in ('asignado', 'en_revision') or selected_job.archived_at is not null
  then raise exception 'Job is not assigned or in review'; end if;

  select * into catalog from public.production_code_catalog
  where id = p_catalog_id and is_active;
  if catalog.id is null then raise exception 'Production code unavailable'; end if;
  select * into selected_category from public.price_categories
  where id = actor_profile.price_category_id and active;
  if selected_category.id is null then raise exception 'Technician price category is not configured'; end if;
  select r.unit_price into selected_rate
  from public.production_code_rates r
  where r.catalog_item_id = catalog.id
    and r.price_category_id = selected_category.id and r.active
    and r.effective_from <= (now() at time zone 'America/New_York')::date
  order by r.effective_from desc, r.created_at desc, r.id desc limit 1;
  if selected_rate is null then raise exception 'Production code has no configured rate for technician category'; end if;

  perform public.require_active_technician_shift(actor);
  insert into public.job_production_codes(
    job_id, code, quantity, notes, added_by, catalog_id,
    credited_technician_id, technician_type_snapshot, unit_snapshot,
    unit_rate_snapshot, amount_snapshot, production_date,
    description_snapshot, price_category_id, price_category_name_snapshot
  ) values (
    p_job_id, catalog.code, p_quantity, nullif(btrim(p_notes), ''), actor,
    catalog.id, actor,
    case selected_category.slug when 'inhouse' then 'in_house'
      when 'subcontractor' then 'contractor' else null end,
    catalog.unit, selected_rate, round(p_quantity * selected_rate, 2),
    coalesce(p_production_date, (now() at time zone 'America/New_York')::date),
    catalog.description, selected_category.id, selected_category.name
  ) returning id into result_id;
  return result_id;
end;
$$;

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
    or selected_job.main_status not in ('asignado', 'en_revision') or selected_job.archived_at is not null
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

create or replace function public.confirm_delivered_job_pdf_with_allocations(
  p_job_id uuid, p_storage_path text, p_source_photo_ids uuid[],
  p_source_document_ids uuid[], p_submit boolean,
  p_expected_draft_version integer, p_snapshot_hash text,
  p_allocations jsonb, p_allocation_idempotency_key uuid
)
returns table(previous_storage_path text, delivered_status public.job_status, delivery_id uuid, allocation_version_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  confirmed record;
  existing public.job_deliveries%rowtype;
  previous_path text;
  allocation_id uuid;
begin
  if not public.can_mutate_job(p_job_id, actor)
    or (p_submit and not public.is_operational_worker(actor))
  then
    raise exception 'Job unavailable';
  end if;
  if p_submit and (p_allocation_idempotency_key is null or jsonb_typeof(p_allocations) <> 'array') then
    raise exception 'A valid financial allocation is required for delivery';
  end if;

  select * into existing from public.job_deliveries where storage_path = p_storage_path;
  if existing.id is not null then
    if not p_submit or not existing.submitted or existing.superseded_at is not null
      or existing.job_id <> p_job_id or existing.delivered_by is distinct from actor
    then raise exception 'Delivery idempotency conflict'; end if;
    select d.storage_path into previous_path from public.job_deliveries d where d.id = existing.replaces_delivery_id;
    allocation_id := public.create_delivery_allocation_version_internal(
      existing.id, 0, p_allocations, p_allocation_idempotency_key, 'Initial delivery allocation'
    );
    return query select previous_path, 'en_revision'::public.job_status, existing.id, allocation_id;
    return;
  end if;

  select * into confirmed from public.confirm_delivered_job_pdf_complete_before_allocations(
    p_job_id, p_storage_path, p_source_photo_ids, p_source_document_ids,
    p_submit, p_expected_draft_version, p_snapshot_hash
  );
  if p_submit then
    allocation_id := public.create_delivery_allocation_version_internal(
      confirmed.delivery_id, 0, p_allocations, p_allocation_idempotency_key,
      'Initial delivery allocation'
    );
  end if;
  return query select confirmed.previous_storage_path, confirmed.delivered_status,
    confirmed.delivery_id, allocation_id;
end;
$$;

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
-- 2b. RLS gates: asignado is execution; en_revision remains editable.
-- ---------------------------------------------------------------------------

drop policy if exists "Technicians can add production codes to assigned jobs" on public.job_production_codes;
create policy "Technicians can add production codes to assigned jobs"
on public.job_production_codes for insert to authenticated
with check (
  added_by = auth.uid() and public.can_mutate_job(job_id)
  and exists (select 1 from public.jobs j where j.id = job_id and j.main_status in ('asignado', 'en_revision'))
);

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
    public.is_admin(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(job_id)
    )
  )
);

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
    public.is_admin(auth.uid())
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
    public.is_admin(auth.uid())
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
    public.is_admin(auth.uid())
    or (
      public.is_operational_worker(auth.uid())
      and public.can_mutate_job(public.job_id_from_storage_path(name))
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3. billing_state: listo_pagar is replaced by facturado.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_weekly_production(p_reference_date date default null)
returns table(
  week_start date, week_end date, production_date date, code text,
  description text, unit text, quantity numeric, amount numeric,
  billing_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select coalesce(p_reference_date, (clock_timestamp() at time zone 'America/New_York')::date) as ref
  ), week as (
    select (ref - ((extract(dow from ref)::integer + 2) % 7))::date as starts
    from bounds
  ), instants as (
    select starts,
      starts::timestamp at time zone 'America/New_York' as starts_at,
      (starts + 7)::timestamp at time zone 'America/New_York' as ends_at
    from week
  )
  select w.starts, w.starts + 6,
    (l.credited_at at time zone 'America/New_York')::date,
    l.code, coalesce(c.description, legacy_catalog.description, l.code),
    l.unit_snapshot, l.quantity, l.amount_snapshot,
    case when j.main_status in ('aprobado','facturado','pagado')
      then 'confirmed' else 'pending' end
  from instants w
  join public.job_delivery_production_lines l
    on l.credited_at >= w.starts_at and l.credited_at < w.ends_at
  join public.job_deliveries d
    on d.id = l.delivery_id and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = l.job_id
  left join public.job_pdf_annotations a on a.id = l.source_annotation_id
  left join public.production_code_catalog c on c.id = a.catalog_id
  left join public.job_production_codes legacy on legacy.id = l.legacy_production_code_id
  left join public.production_code_catalog legacy_catalog on legacy_catalog.id = legacy.catalog_id
  where l.credited_technician_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'tecnico' and p.is_active
    )
  order by 3, l.code;
$$;

create or replace function public.get_production_report(p_start_date date, p_end_date date)
returns table(
  production_date date, technician_id uuid, technician_name text,
  code text, description text, unit text, quantity numeric,
  unit_rate numeric, amount numeric, billing_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366
  then raise exception 'Invalid date range'; end if;
  starts_at := p_start_date::timestamp at time zone 'America/New_York';
  ends_at := (p_end_date + 1)::timestamp at time zone 'America/New_York';

  return query
  select (l.credited_at at time zone 'America/New_York')::date,
    l.credited_technician_id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    l.code, coalesce(c.description, legacy_catalog.description, l.code),
    l.unit_snapshot, l.quantity, l.unit_rate_snapshot, l.amount_snapshot,
    case when j.main_status in ('aprobado','facturado','pagado')
      then 'confirmed' else 'pending' end
  from public.job_delivery_production_lines l
  join public.job_deliveries d
    on d.id = l.delivery_id and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = l.job_id
  join public.profiles p on p.id = l.credited_technician_id
  left join public.job_pdf_annotations a on a.id = l.source_annotation_id
  left join public.production_code_catalog c on c.id = a.catalog_id
  left join public.job_production_codes legacy on legacy.id = l.legacy_production_code_id
  left join public.production_code_catalog legacy_catalog on legacy_catalog.id = legacy.catalog_id
  where l.credited_at >= starts_at and l.credited_at < ends_at
  order by 1 desc, 3, l.code;
end;
$$;

create or replace function public.get_my_weekly_financial_allocations(p_reference_date date default null)
returns table(
  week_start date, week_end date, allocation_date date,
  job_id uuid, delivery_id uuid, prism_number text,
  percentage_basis_points integer, allocated_cents bigint,
  billing_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select coalesce(p_reference_date, (clock_timestamp() at time zone 'America/New_York')::date) as ref
  ), week as (
    select (ref - ((extract(dow from ref)::integer + 2) % 7))::date as starts from bounds
  )
  select w.starts, w.starts + 6,
    (d.confirmed_at at time zone 'America/New_York')::date,
    v.job_id, v.delivery_id, j.prism_number,
    a.percentage_basis_points, a.allocated_cents,
    case when j.main_status in ('aprobado', 'facturado', 'pagado')
      then 'confirmed' else 'pending' end
  from week w
  join public.job_delivery_financial_allocations a on a.participant_id = auth.uid()
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
    and v.superseded_at is null and v.voided_at is null
  join public.job_deliveries d on d.id = v.delivery_id
    and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = v.job_id and j.current_delivery_id = d.id
  where (d.confirmed_at at time zone 'America/New_York')::date between w.starts and w.starts + 6
    and public.is_field_worker(auth.uid())
  order by 3, j.prism_number, v.job_id;
$$;

create or replace function public.get_financial_allocation_report(p_start_date date, p_end_date date)
returns table(
  allocation_date date, job_id uuid, delivery_id uuid, prism_number text,
  participant_id uuid, participant_name text, worker_specialty text,
  percentage_basis_points integer, allocated_cents bigint,
  source_amount_cents bigint, billing_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366 then raise exception 'Invalid date range'; end if;
  return query
  select (d.confirmed_at at time zone 'America/New_York')::date,
    v.job_id, v.delivery_id, j.prism_number,
    a.participant_id, a.participant_name_snapshot, a.worker_specialty_snapshot,
    a.percentage_basis_points, a.allocated_cents, v.source_amount_cents,
    case when j.main_status in ('aprobado', 'facturado', 'pagado')
      then 'confirmed' else 'pending' end
  from public.job_delivery_financial_allocations a
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
    and v.superseded_at is null and v.voided_at is null
  join public.job_deliveries d on d.id = v.delivery_id
    and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = v.job_id and j.current_delivery_id = d.id
  where (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
  order by 1 desc, a.participant_name_snapshot, v.job_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Supervisor permissions: archive and permanent deletion stop being
--    admin-only. Prices and users stay admin-only.
-- ---------------------------------------------------------------------------

create or replace function public.set_job_archived_v2(
  p_job_id uuid,
  p_archived boolean,
  p_reason_code text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  clean_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  event_time timestamptz := clock_timestamp();
  reason_label text;
begin
  if not public.is_office_staff(actor) then raise exception 'Office access required'; end if;
  if p_archived is null then raise exception 'Archive state required'; end if;
  if p_archived and p_reason_code not in (
    'duplicate_job', 'cancelled_by_client_or_office', 'incorrect_address_or_data',
    'no_access_or_blocked_conditions', 'out_of_scope'
  ) then raise exception 'Archive reason required'; end if;
  if clean_notes is not null and char_length(clean_notes) > 2000 then
    raise exception 'Archive notes are too long';
  end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null then raise exception 'Job unavailable'; end if;
  if p_archived = (selected_job.archived_at is not null) then return; end if;

  reason_label := case p_reason_code
    when 'duplicate_job' then 'Trabajo duplicado'
    when 'cancelled_by_client_or_office' then 'Cancelado por el cliente o la oficina'
    when 'incorrect_address_or_data' then 'Dirección o datos incorrectos'
    when 'no_access_or_blocked_conditions' then 'Sin acceso o condiciones que impiden realizarlo'
    when 'out_of_scope' then 'Fuera de alcance o no corresponde a Susotech'
  end;

  perform set_config('app.job_archive_mutation', actor::text, true);
  update public.jobs
  set archived_at = case when p_archived then event_time else null end,
      archived_by = case when p_archived then actor else null end,
      archive_reason = case when p_archived then reason_label else null end,
      archive_reason_code = case when p_archived then p_reason_code else null end,
      archive_notes = case when p_archived then clean_notes else null end,
      updated_at = event_time
  where id = p_job_id;

  insert into public.job_archive_events(
    job_id, event_type, reason_code, notes, actor_id, occurred_at, is_legacy
  ) values (
    p_job_id, case when p_archived then 'archived' else 'restored' end,
    case when p_archived then p_reason_code else null end,
    case when p_archived then clean_notes else null end,
    actor, event_time, false
  );
end;
$$;

create or replace function public.delete_archived_job(p_job_id uuid)
returns table(queue_id bigint, bucket_id text, object_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
begin
  if not public.is_office_staff(actor) then
    raise exception 'Office access required';
  end if;

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;

  if selected_job.id is not null then
    if selected_job.archived_at is null then
      raise exception 'Only archived jobs can be permanently deleted';
    end if;

    insert into public.job_deletion_cleanup_queue (
      job_id, bucket_id, object_name, requested_by
    )
    select p_job_id, o.bucket_id, o.name, actor
    from storage.objects o
    where o.bucket_id in ('project-files', 'job-evidence')
      and o.name like p_job_id::text || '/%'
    on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key do update
      set job_id = excluded.job_id,
          requested_by = excluded.requested_by,
          last_error = null;

    delete from public.jobs where id = p_job_id;
  elsif not exists (
    select 1 from public.job_deletion_cleanup_queue q where q.job_id = p_job_id
  ) then
    raise exception 'Job unavailable';
  end if;

  return query
  select q.id, q.bucket_id, q.object_name
  from public.job_deletion_cleanup_queue q
  where q.job_id = p_job_id
  order by q.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Catalog: technicians only see items with an active rate for their own
--    price category.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_production_catalog()
returns table(
  id uuid, code text, description text, unit text, unit_rate numeric,
  price_category_id uuid, price_category_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.code, c.description, c.unit, rate.unit_price, pc.id, pc.name
  from public.profiles p
  join public.price_categories pc
    on pc.id = p.price_category_id and pc.active
  cross join public.production_code_catalog c
  join lateral (
    select r.unit_price
    from public.production_code_rates r
    where r.catalog_item_id = c.id
      and r.price_category_id = pc.id
      and r.active
      and r.effective_from <= (now() at time zone 'America/New_York')::date
    order by r.effective_from desc, r.created_at desc, r.id desc
    limit 1
  ) rate on true
  where p.id = auth.uid() and p.is_active and p.role = 'tecnico' and c.is_active
  order by c.sort_order, c.code, c.description, c.id;
$$;
