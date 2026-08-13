-- Enforce the ten-hour technician shift at every database boundary that can
-- read or mutate operational job state. Office roles keep their current access.

create or replace function public.has_active_technician_shift(
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with checked as (
    select clock_timestamp() as checked_at
  )
  select exists (
    select 1
    from public.technician_shifts s
    cross join checked
    where (
        check_user_id = auth.uid()
        or public.is_office_staff(auth.uid())
        or auth.role() = 'service_role'
      )
      and s.technician_id = check_user_id
      and s.started_at <= checked.checked_at
      and s.active_until > checked.checked_at
  );
$$;

revoke all on function public.has_active_technician_shift(uuid) from public;
grant execute on function public.has_active_technician_shift(uuid) to authenticated;

create or replace function public.require_active_technician_shift(
  check_user_id uuid default auth.uid()
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if public.is_technician(check_user_id)
    and not public.has_active_technician_shift(check_user_id)
  then
    raise exception 'Tu jornada de trabajo terminó. Inicia una nueva jornada para continuar.';
  end if;
end;
$$;

revoke all on function public.require_active_technician_shift(uuid) from public;

create or replace function public.can_access_job(
  check_job_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if check_user_id <> auth.uid()
    and not public.is_office_staff(auth.uid())
    and auth.role() <> 'service_role'
  then return false; end if;

  if public.is_office_staff(check_user_id) then return true; end if;
  if not public.is_technician(check_user_id) then return false; end if;

  perform public.require_active_technician_shift(check_user_id);

  return exists (
    select 1
    from public.jobs j
    join public.job_assignments ja on ja.job_id = j.id
    where j.id = check_job_id
      and j.archived_at is null
      and ja.active
      and (
        (ja.assignee_type = 'technician' and ja.technician_id = check_user_id)
        or (
          ja.assignee_type = 'crew'
          and exists (
            select 1
            from public.crews c
            where c.id = ja.crew_id
              and c.is_active
              and (
                c.lead_technician_id = check_user_id
                or exists (
                  select 1
                  from public.crew_members cm
                  where cm.crew_id = c.id
                    and cm.technician_id = check_user_id
                )
              )
          )
        )
      )
  );
end;
$$;

revoke all on function public.can_access_job(uuid, uuid) from public;
grant execute on function public.can_access_job(uuid, uuid) to authenticated;

drop policy if exists "Technicians can view their assignments"
on public.job_assignments;
create policy "Technicians can view their assignments"
on public.job_assignments for select
to authenticated
using (
  public.is_technician()
  and public.has_active_technician_shift()
  and active
  and (
    (assignee_type = 'technician' and technician_id = auth.uid())
    or (assignee_type = 'crew' and public.can_access_crew(crew_id))
  )
);

-- RLS hides expired jobs. This trigger is the authoritative mutation boundary
-- and preserves the required user-facing error even if the shift expires after
-- a row was read but before its UPDATE reaches PostgreSQL.
create or replace function public.guard_active_technician_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_active_technician_shift(auth.uid());
  return new;
end;
$$;

drop trigger if exists guard_active_shift_job_update_before_update
on public.jobs;
create trigger guard_active_shift_job_update_before_update
before update on public.jobs
for each row execute function public.guard_active_technician_mutation();

drop trigger if exists guard_active_shift_production_before_write
on public.job_production_codes;
create trigger guard_active_shift_production_before_write
before insert or update on public.job_production_codes
for each row execute function public.guard_active_technician_mutation();

drop trigger if exists guard_active_shift_draft_before_write
on public.job_pdf_drafts;
create trigger guard_active_shift_draft_before_write
before insert or update on public.job_pdf_drafts
for each row execute function public.guard_active_technician_mutation();

drop trigger if exists guard_active_shift_photo_before_write
on public.job_photos;
create trigger guard_active_shift_photo_before_write
before insert or update on public.job_photos
for each row execute function public.guard_active_technician_mutation();

revoke all on function public.guard_active_technician_mutation() from public;

create or replace function public.add_job_production(
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
  selected_job public.jobs%rowtype;
  result_id uuid;
begin
  select * into actor_profile
  from public.profiles
  where id = actor and is_active and role = 'tecnico';
  if actor_profile.id is null then raise exception 'Active technician required'; end if;
  perform public.require_active_technician_shift(actor);

  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_production_date is not null
    and p_production_date <> (now() at time zone 'America/New_York')::date
  then raise exception 'Technicians cannot backdate production'; end if;

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;
  perform public.require_active_technician_shift(actor);

  if selected_job.id is null or not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;
  if selected_job.main_status <> 'en_progreso' or selected_job.archived_at is not null then
    raise exception 'Job is not in progress';
  end if;

  select * into catalog
  from public.production_code_catalog
  where id = p_catalog_id and is_active;
  if catalog.id is null then raise exception 'Production code unavailable'; end if;

  perform public.require_active_technician_shift(actor);
  insert into public.job_production_codes(
    job_id, code, quantity, notes, added_by, catalog_id,
    credited_technician_id, technician_type_snapshot, unit_snapshot,
    unit_rate_snapshot, amount_snapshot, production_date
  ) values (
    p_job_id, catalog.code, p_quantity, nullif(btrim(p_notes), ''), actor,
    catalog.id, actor, actor_profile.technician_type, catalog.unit,
    case actor_profile.technician_type
      when 'contractor' then catalog.contractor_rate
      else catalog.in_house_rate
    end,
    round(p_quantity * (case actor_profile.technician_type
      when 'contractor' then catalog.contractor_rate
      else catalog.in_house_rate
    end), 2),
    coalesce(p_production_date, (now() at time zone 'America/New_York')::date)
  ) returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.add_job_production(uuid, uuid, numeric, date, text)
from public;
grant execute on function public.add_job_production(uuid, uuid, numeric, date, text)
to authenticated;

create or replace function public.initialize_job_pdf_draft(
  p_job_id uuid,
  p_page_count integer
)
returns table(version integer, source_page_count integer, placements jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
begin
  if not public.is_technician(actor) then raise exception 'Job unavailable'; end if;
  perform public.require_active_technician_shift(actor);

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;
  perform public.require_active_technician_shift(actor);

  if selected_job.id is null or not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;
  if selected_job.main_status <> 'en_progreso' or selected_job.archived_at is not null then
    raise exception 'Job is not editable';
  end if;
  if p_page_count not between 1 and 50 then raise exception 'Invalid page count'; end if;

  perform public.require_active_technician_shift(actor);
  insert into public.job_pdf_drafts(job_id, source_page_count, updated_by)
  values(p_job_id, p_page_count, actor)
  on conflict(job_id) do update
    set source_page_count = excluded.source_page_count
    where job_pdf_drafts.version = 0
      and job_pdf_drafts.placements = '[]'::jsonb;

  return query
  select d.version, d.source_page_count, d.placements
  from public.job_pdf_drafts d
  where d.job_id = p_job_id;
end;
$$;

revoke all on function public.initialize_job_pdf_draft(uuid, integer) from public;
grant execute on function public.initialize_job_pdf_draft(uuid, integer)
to authenticated;

create or replace function public.save_job_pdf_draft(
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
  item jsonb;
  a jsonb;
  result_version integer;
begin
  if not public.is_technician(actor) then raise exception 'Job unavailable'; end if;
  perform public.require_active_technician_shift(actor);

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;
  perform public.require_active_technician_shift(actor);

  if selected_job.id is null or not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;
  if selected_job.main_status <> 'en_progreso' or selected_job.archived_at is not null then
    raise exception 'Job is not editable';
  end if;

  select * into draft
  from public.job_pdf_drafts
  where job_id = p_job_id
  for update;
  perform public.require_active_technician_shift(actor);

  if draft.job_id is null then raise exception 'Draft unavailable'; end if;
  if draft.version <> p_expected_version then raise exception 'Draft version conflict'; end if;
  if jsonb_typeof(p_placements) <> 'array' or jsonb_array_length(p_placements) > 500 then
    raise exception 'Invalid placements';
  end if;

  for item in select value from jsonb_array_elements(p_placements) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['id','catalogId','page','x','y','width','height'])
      or jsonb_typeof(item->'page') <> 'number'
      or jsonb_typeof(item->'x') <> 'number'
      or jsonb_typeof(item->'y') <> 'number'
      or jsonb_typeof(item->'width') <> 'number'
      or jsonb_typeof(item->'height') <> 'number'
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'catalogId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'page')::numeric <> trunc((item->>'page')::numeric)
      or (item->>'page')::integer not between 1 and draft.source_page_count
      or (item->>'x')::numeric < 0
      or (item->>'y')::numeric < 0
      or (item->>'width')::numeric not between 0.04 and 0.35
      or (item->>'height')::numeric not between 0.025 and 0.20
      or (item->>'x')::numeric + (item->>'width')::numeric > 1
      or (item->>'y')::numeric + (item->>'height')::numeric > 1
      or not exists (
        select 1
        from public.production_code_catalog c
        where c.id = (item->>'catalogId')::uuid and c.is_active
      )
    then raise exception 'Invalid placement'; end if;

    for a in
      select value
      from jsonb_array_elements(p_placements)
      where value->>'id' < item->>'id'
        and (value->>'page')::integer = (item->>'page')::integer
    loop
      if (item->>'x')::numeric < (a->>'x')::numeric + (a->>'width')::numeric
        and (item->>'x')::numeric + (item->>'width')::numeric > (a->>'x')::numeric
        and (item->>'y')::numeric < (a->>'y')::numeric + (a->>'height')::numeric
        and (item->>'y')::numeric + (item->>'height')::numeric > (a->>'y')::numeric
      then raise exception 'Placements overlap'; end if;
    end loop;
  end loop;

  if (
    select count(*) <> count(distinct value->>'id')
    from jsonb_array_elements(p_placements)
  ) then raise exception 'Duplicate placement id'; end if;

  perform public.require_active_technician_shift(actor);
  update public.job_pdf_drafts
  set placements = p_placements,
      version = version + 1,
      updated_by = actor,
      updated_at = now()
  where job_id = p_job_id
  returning version into result_version;

  return result_version;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid placement';
end;
$$;

revoke all on function public.save_job_pdf_draft(uuid, integer, jsonb) from public;
grant execute on function public.save_job_pdf_draft(uuid, integer, jsonb)
to authenticated;

create or replace function public.confirm_delivered_job_pdf(
  p_job_id uuid,
  p_storage_path text,
  p_source_photo_ids uuid[],
  p_submit boolean default false
)
returns table(previous_storage_path text, delivered_status public.job_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  current_photo_ids uuid[];
  supplied_photo_ids uuid[];
  stored_size bigint;
  stored_mime text;
  stored_generator text;
  stored_job_id text;
  stored_photo_ids text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  perform public.require_active_technician_shift(actor);

  select * into selected_job
  from public.jobs
  where id = p_job_id
  for update;
  perform public.require_active_technician_shift(actor);

  if selected_job.id is null or not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;

  if public.is_technician(actor) then
    if not p_submit or selected_job.main_status <> 'en_progreso' then
      raise exception 'Technicians can only deliver jobs in progress';
    end if;
  elsif public.is_admin(actor) then
    if p_submit or selected_job.main_status not in ('en_progreso', 'enviado_revision') then
      raise exception 'Administrators can only regenerate an editable delivered PDF';
    end if;
  else
    raise exception 'Delivered PDF confirmation is not authorized';
  end if;

  if p_storage_path !~ (
    '^' || p_job_id::text
    || '/delivered/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]pdf$'
  ) then raise exception 'Delivered PDF path is invalid'; end if;

  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into current_photo_ids
  from public.job_photos p
  where p.job_id = p_job_id and p.deleted_at is null;

  select coalesce(array_agg(value order by value), '{}'::uuid[])
  into supplied_photo_ids
  from unnest(coalesce(p_source_photo_ids, '{}'::uuid[])) as supplied(value);

  if cardinality(current_photo_ids) = 0 then
    raise exception 'At least one confirmed evidence photo is required';
  end if;
  if current_photo_ids is distinct from supplied_photo_ids then
    raise exception 'Evidence changed while the delivered PDF was generated';
  end if;

  select nullif(o.metadata ->> 'size', '')::bigint,
    lower(o.metadata ->> 'mimetype'),
    o.user_metadata ->> 'generator',
    o.user_metadata ->> 'job_id',
    o.user_metadata ->> 'source_photo_ids'
  into stored_size, stored_mime, stored_generator, stored_job_id, stored_photo_ids
  from storage.objects o
  where o.bucket_id = 'project-files' and o.name = p_storage_path;

  if stored_size is null or stored_size <= 0 or stored_size > 104857600
    or stored_mime is distinct from 'application/pdf'
    or stored_generator is distinct from 'susotech-portal'
    or stored_job_id is distinct from p_job_id::text
    or stored_photo_ids is distinct from array_to_string(current_photo_ids, ',')
  then raise exception 'Delivered PDF object is missing or invalid'; end if;

  perform public.require_active_technician_shift(actor);
  perform set_config('app.delivered_pdf_confirmation', actor::text, true);

  return query
  update public.jobs
  set delivered_pdf_path = p_storage_path,
      delivered_pdf_generated_at = now(),
      delivered_pdf_generated_by = actor,
      delivered_pdf_source_photo_ids = current_photo_ids,
      main_status = case
        when p_submit then 'enviado_revision'::public.job_status
        else main_status
      end
  where id = p_job_id
  returning selected_job.delivered_pdf_path, jobs.main_status;
end;
$$;

revoke all on function public.confirm_delivered_job_pdf(uuid, text, uuid[], boolean)
from public;
grant execute on function public.confirm_delivered_job_pdf(uuid, text, uuid[], boolean)
to authenticated;

create or replace function public.confirm_delivered_job_pdf_versioned(
  p_job_id uuid,
  p_storage_path text,
  p_source_photo_ids uuid[],
  p_submit boolean,
  p_expected_draft_version integer
)
returns table(previous_storage_path text, delivered_status public.job_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  draft public.job_pdf_drafts%rowtype;
  previous_path text;
  result_status public.job_status;
begin
  perform public.require_active_technician_shift(actor);

  select * into draft
  from public.job_pdf_drafts
  where job_id = p_job_id
  for update;
  perform public.require_active_technician_shift(actor);

  if draft.job_id is null or draft.version <> p_expected_draft_version then
    raise exception 'Draft version conflict';
  end if;

  select c.previous_storage_path, c.delivered_status
  into previous_path, result_status
  from public.confirm_delivered_job_pdf(
    p_job_id, p_storage_path, p_source_photo_ids, p_submit
  ) c;

  perform public.require_active_technician_shift(actor);
  insert into public.job_pdf_delivery_versions(
    job_id, draft_version, delivered_path
  ) values (
    p_job_id, draft.version, p_storage_path
  )
  on conflict(job_id) do update
    set draft_version = excluded.draft_version,
        delivered_path = excluded.delivered_path,
        confirmed_at = now();

  return query select previous_path, result_status;
end;
$$;

revoke all on function public.confirm_delivered_job_pdf_versioned(
  uuid, text, uuid[], boolean, integer
) from public;
grant execute on function public.confirm_delivered_job_pdf_versioned(
  uuid, text, uuid[], boolean, integer
) to authenticated;
