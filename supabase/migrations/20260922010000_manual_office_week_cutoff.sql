-- Prospective only: no UPDATE or backfill of existing manual jobs.
begin;

create table public.manual_job_feature_activation (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null,
  first_financial_week date not null check (extract(dow from first_financial_week) = 5)
);
alter table public.manual_job_feature_activation enable row level security;
revoke all on public.manual_job_feature_activation from public, anon, authenticated, service_role;
insert into public.manual_job_feature_activation (activated_at, first_financial_week)
select at, local_day - ((extract(dow from local_day)::integer + 2) % 7)
from (select at, (at at time zone 'America/New_York')::date as local_day
      from (select clock_timestamp() as at) instant) activation;

alter table public.manual_jobs
  add column description text,
  add column work_date date,
  add column financial_week_start date,
  add column revision integer,
  add constraint manual_job_feature_metadata check (
    (financial_week_start is null and revision is null and work_date is null and description is null)
    or (financial_week_start is not null and revision is not null and revision > 0
        and work_date is not null and extract(dow from financial_week_start) = 5)
  );

-- Pure shared financial date: NULL-era records retain the exact old local date.
create function public.manual_job_financial_date(p_week date, p_reviewed_at timestamptz)
returns date language sql immutable set search_path = '' as $$
  select coalesce(p_week, (p_reviewed_at at time zone 'America/New_York')::date)
$$;

create function public.get_manual_job_creation_context()
returns table(first_financial_week date, current_financial_week date, today date)
language plpgsql stable security definer set search_path = '' as $$
declare local_day date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  if not (public.is_office_staff(auth.uid()) or public.is_field_worker(auth.uid())) then
    raise exception 'Manual job creation access required';
  end if;
  return query select a.first_financial_week,
    local_day - ((extract(dow from local_day)::integer + 2) % 7), local_day
  from public.manual_job_feature_activation a;
end;
$$;

-- Internal validation is shared by creation and the later office editor.
create function public.validate_manual_job_input(
  p_prism_number text, p_value_cents bigint, p_workers jsonb,
  p_description text, p_work_date date, p_financial_week date
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry jsonb;
  worker_id uuid;
  bps integer;
  total bigint := 0;
  seen uuid[] := '{}';
  first_week date;
begin
  if nullif(btrim(p_prism_number), '') is null or length(btrim(p_prism_number)) > 100 then
    raise exception 'PRISM number required (maximum 100 characters)';
  end if;
  -- Bound multiplication in legacy-compatible list RPCs as well as JS integers.
  if p_value_cents is null or p_value_cents <= 0 or p_value_cents > 900719925474099 then
    raise exception 'Value must be positive safe integer cents';
  end if;
  if length(p_description) > 2000 then raise exception 'Description is too long'; end if;
  if p_work_date is null or not isfinite(p_work_date) or p_work_date < date '0001-01-01'
     or p_work_date > (clock_timestamp() at time zone 'America/New_York')::date then
    raise exception 'A valid work date no later than today is required';
  end if;
  select a.first_financial_week into strict first_week from public.manual_job_feature_activation a;
  if p_financial_week is null or not isfinite(p_financial_week)
     or p_financial_week < first_week or p_financial_week > date '9999-12-24'
     or extract(dow from p_financial_week) <> 5 then
    raise exception 'Select a Friday financial week on or after activation';
  end if;
  if p_workers is null or jsonb_typeof(p_workers) <> 'array' then
    raise exception 'Workers must be an array';
  end if;
  if jsonb_array_length(p_workers) = 0 then raise exception 'At least one worker is required'; end if;
  for entry in select * from jsonb_array_elements(p_workers) loop
    worker_id := (entry->>'technicianId')::uuid;
    bps := (entry->>'percentageBasisPoints')::integer;
    if worker_id is null or bps is null or bps not between 1 and 10000 then
      raise exception 'Invalid worker entry';
    end if;
    if worker_id = any(seen) then raise exception 'Duplicate worker'; end if;
    if not public.is_field_worker(worker_id) then raise exception 'Worker is not an active technician'; end if;
    seen := array_append(seen, worker_id);
    total := total + bps;
  end loop;
  if total <> 10000 then raise exception 'Percentages must total 100'; end if;
end;
$$;

create function public.create_manual_job_v2(
  p_prism_number text, p_value_cents bigint, p_workers jsonb,
  p_description text default null, p_work_date date default null, p_financial_week date default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  office boolean := public.is_office_staff(auth.uid());
  registered_at timestamptz := clock_timestamp();
  local_day date := (registered_at at time zone 'America/New_York')::date;
  selected_week date;
  selected_work_date date := coalesce(p_work_date, local_day);
  job_id uuid;
begin
  if not (office or public.is_field_worker(auth.uid())) then raise exception 'Manual job creation access required'; end if;
  if office then
    if nullif(btrim(p_description), '') is null or p_work_date is null or p_financial_week is null then
      raise exception 'Description, work date and financial week are required for office creation';
    end if;
    selected_week := p_financial_week;
  else
    if p_financial_week is not null then raise exception 'Only office staff can select a financial week'; end if;
    selected_week := local_day - ((extract(dow from local_day)::integer + 2) % 7);
  end if;
  perform public.validate_manual_job_input(p_prism_number, p_value_cents, p_workers,
    p_description, selected_work_date, selected_week);
  insert into public.manual_jobs (
    prism_number, value_cents, created_by, description, work_date, financial_week_start, revision, created_at, updated_at
  ) values (upper(btrim(p_prism_number)), p_value_cents, auth.uid(), nullif(btrim(p_description), ''),
    selected_work_date, selected_week, 1, registered_at, registered_at) returning id into job_id;
  insert into public.manual_job_workers (manual_job_id, technician_id, percentage_basis_points)
  select job_id, (w->>'technicianId')::uuid, (w->>'percentageBasisPoints')::integer
  from jsonb_array_elements(p_workers) w;
  return job_id;
end;
$$;

-- Preserve the old technician signature but stamp every new record prospectively.
create or replace function public.create_manual_job(p_prism_number text, p_value_cents bigint, p_workers jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_field_worker(auth.uid()) then raise exception 'Field worker required'; end if;
  return public.create_manual_job_v2(p_prism_number, p_value_cents, p_workers);
end;
$$;

-- Versioned read model reuses the existing participant-scoped roster and office
-- viewer authorization. Existing RPC signatures remain available to older clients.
create function public.list_manual_jobs_v2()
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.is_office_viewer(auth.uid()) then
    return query select to_jsonb(j) || jsonb_build_object(
      'description', m.description, 'work_date', m.work_date,
      'financial_week_start', m.financial_week_start, 'revision', m.revision)
    from public.list_manual_jobs_for_office() j join public.manual_jobs m on m.id = j.id;
  elsif public.is_field_worker(auth.uid()) then
    return query select to_jsonb(j) || jsonb_build_object(
      'description', m.description, 'work_date', m.work_date,
      'financial_week_start', m.financial_week_start, 'revision', m.revision)
    from public.list_my_manual_jobs() j join public.manual_jobs m on m.id = j.id;
  else
    raise exception 'Active manual job viewer required';
  end if;
end;
$$;

create function public.get_my_weekly_manual_earnings_v2(p_reference_date date default null)
returns table(
  week_start date, week_end_exclusive date, approval_date date, manual_job_id uuid,
  prism_number text, source_amount_cents bigint, percentage_basis_points integer,
  allocated_cents bigint, review_status text, financial_date date
)
language plpgsql stable security definer set search_path = '' as $$
declare
  ref date := coalesce(p_reference_date, (clock_timestamp() at time zone 'America/New_York')::date);
  starts_on date := ref - ((extract(dow from ref)::integer + 2) % 7);
begin
  if not public.is_field_worker(auth.uid()) then return; end if;
  return query select starts_on, starts_on + 7,
    (mj.reviewed_at at time zone 'America/New_York')::date,
    mj.id, mj.prism_number, mj.value_cents, mw.percentage_basis_points,
    round((mj.value_cents::numeric * mw.percentage_basis_points) / 10000.0)::bigint,
    'approved'::text, public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at)
  from public.manual_job_workers mw join public.manual_jobs mj on mj.id = mw.manual_job_id
  where mw.technician_id = auth.uid() and mj.status = 'approved'
    and public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at) >= starts_on
    and public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at) < starts_on + 7
  order by public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at), mj.reviewed_at, mj.prism_number, mj.id;
end;
$$;

create or replace function public.get_my_weekly_manual_earnings(p_reference_date date default null)
returns table(
  week_start date, week_end_exclusive date, approval_date date, manual_job_id uuid,
  prism_number text, source_amount_cents bigint, percentage_basis_points integer,
  allocated_cents bigint, review_status text
)
language sql stable security definer set search_path = '' as $$
  select e.week_start, e.week_end_exclusive, e.approval_date, e.manual_job_id,
    e.prism_number, e.source_amount_cents, e.percentage_basis_points, e.allocated_cents, e.review_status
  from public.get_my_weekly_manual_earnings_v2(p_reference_date) e
$$;

create or replace function public.get_worker_weekly_financial_dashboard(p_reference_at timestamptz default clock_timestamp())
returns table(participant_id uuid, allocated_cents bigint, allocation_count bigint,
  week_start_at timestamptz, week_end_exclusive_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  as_of timestamptz := coalesce(p_reference_at, clock_timestamp());
  local_date date := (as_of at time zone 'America/New_York')::date;
  start_date date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  start_date := local_date - ((extract(dow from local_date)::integer + 2) % 7);
  starts_at := start_date::timestamp at time zone 'America/New_York';
  ends_at := (start_date + 7)::timestamp at time zone 'America/New_York';
  return query
  select a.participant_id, sum(a.allocated_cents)::bigint, count(*)::bigint, starts_at, ends_at
  from public.job_delivery_financial_allocations a
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
    and v.superseded_at is null and v.voided_at is null
  join public.job_deliveries d on d.id = v.delivery_id and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = v.job_id and j.current_delivery_id = d.id
  where d.confirmed_at >= starts_at and d.confirmed_at < ends_at
  group by a.participant_id
  union all
  select mw.technician_id, sum(round((mw.percentage_basis_points::numeric * mj.value_cents) / 10000.0))::bigint,
    count(*)::bigint, starts_at, ends_at
  from public.manual_job_workers mw
  join public.manual_jobs mj on mj.id = mw.manual_job_id and mj.status = 'approved'
  where public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at) >= start_date
    and public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at) < start_date + 7
  group by mw.technician_id;
end;
$$;

create or replace function public.get_financial_history(p_start_date date, p_end_date date)
returns table(bucket_date date, income_cents bigint, worker_expense_cents bigint, fuel_expense_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366 then raise exception 'Invalid date range'; end if;
  return query
  with dates as (
    select generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day')::date as d
  ), income as (
    select (d.confirmed_at at time zone 'America/New_York')::date as d, coalesce(sum(v.source_amount_cents), 0)::bigint as cents
    from public.job_delivery_allocation_versions v
    join public.job_deliveries d on d.id = v.delivery_id and d.submitted and d.superseded_at is null
    where v.superseded_at is null and v.voided_at is null
      and (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ), worker_expense as (
    select (d.confirmed_at at time zone 'America/New_York')::date as d, coalesce(sum(a.allocated_cents), 0)::bigint as cents
    from public.job_delivery_financial_allocations a
    join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id and v.superseded_at is null and v.voided_at is null
    join public.job_deliveries d on d.id = v.delivery_id and d.submitted and d.superseded_at is null
    where (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ), fuel_expense as (
    select (s.started_at at time zone 'America/New_York')::date as d, coalesce((sum(s.fuel_amount) * 100)::bigint, 0)::bigint as cents
    from public.technician_shifts s
    where (s.started_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ), manual as (
    select public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at) as d,
      coalesce(sum(mj.value_cents), 0)::bigint as worker_cents
    from public.manual_jobs mj
    where mj.status = 'approved'
      and public.manual_job_financial_date(mj.financial_week_start, mj.reviewed_at) between p_start_date and p_end_date
    group by 1
  )
  select dates.d, coalesce(income.cents, 0),
    coalesce(worker_expense.cents, 0) + coalesce(manual.worker_cents, 0), coalesce(fuel_expense.cents, 0)
  from dates left join income on income.d = dates.d
  left join worker_expense on worker_expense.d = dates.d
  left join fuel_expense on fuel_expense.d = dates.d
  left join manual on manual.d = dates.d order by dates.d;
end;
$$;

revoke all on function public.manual_job_financial_date(date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.validate_manual_job_input(text, bigint, jsonb, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.create_manual_job_v2(text, bigint, jsonb, text, date, date) from public, anon, authenticated, service_role;
revoke all on function public.get_manual_job_creation_context() from public, anon, authenticated, service_role;
revoke all on function public.list_manual_jobs_v2() from public, anon, authenticated, service_role;
revoke all on function public.get_my_weekly_manual_earnings_v2(date) from public, anon, authenticated, service_role;
grant execute on function public.create_manual_job_v2(text, bigint, jsonb, text, date, date) to authenticated;
grant execute on function public.get_manual_job_creation_context() to authenticated;
grant execute on function public.list_manual_jobs_v2() to authenticated;
grant execute on function public.get_my_weekly_manual_earnings_v2(date) to authenticated;

commit;
