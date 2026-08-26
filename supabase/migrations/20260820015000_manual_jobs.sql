-- Trabajos manuales: un técnico registra un trabajo hecho fuera del flujo normal
-- (PDF -> entrega), con un valor total en dólares y un reparto porcentual entre
-- trabajadores que suma 100%. El trabajo arranca "pending" y lo aprueba o rechaza
-- un admin/supervisor.

create table public.manual_jobs (
  id uuid primary key default gen_random_uuid(),
  prism_number text not null,
  value_cents bigint not null check (value_cents > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.manual_job_workers (
  id uuid primary key default gen_random_uuid(),
  manual_job_id uuid not null references public.manual_jobs(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  percentage_basis_points integer not null check (percentage_basis_points between 1 and 10000)
);
create index manual_jobs_status_created_idx on public.manual_jobs (status, created_at desc);
create index manual_job_workers_job_idx on public.manual_job_workers (manual_job_id);
create index manual_job_workers_tech_idx on public.manual_job_workers (technician_id);

alter table public.manual_jobs enable row level security;
alter table public.manual_job_workers enable row level security;

create policy "manual_jobs_select" on public.manual_jobs
  for select to authenticated using (auth.uid() = created_by or public.is_office_staff());
create policy "manual_job_workers_select" on public.manual_job_workers
  for select to authenticated using (
    auth.uid() = technician_id or public.is_office_staff()
    or exists (select 1 from public.manual_jobs mj where mj.id = manual_job_id and mj.created_by = auth.uid())
  );

create or replace function public.create_manual_job(p_prism_number text, p_value_cents bigint, p_workers jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prism text;
  v_job_id uuid;
  v_worker jsonb;
  v_technician_id uuid;
  v_bps integer;
  v_total integer := 0;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'tecnico' and is_active) then
    raise exception 'Field worker required';
  end if;

  v_prism := upper(btrim(coalesce(p_prism_number, '')));
  if v_prism = '' then raise exception 'PRISM number required'; end if;
  if length(v_prism) > 100 then raise exception 'PRISM number too long'; end if;

  if p_value_cents is null or p_value_cents <= 0 then
    raise exception 'Value must be greater than zero';
  end if;

  if p_workers is null or jsonb_typeof(p_workers) <> 'array' or jsonb_array_length(p_workers) = 0 then
    raise exception 'At least one worker is required';
  end if;

  for v_worker in select * from jsonb_array_elements(p_workers) loop
    v_technician_id := (v_worker->>'technicianId')::uuid;
    v_bps := (v_worker->>'percentageBasisPoints')::integer;
    if v_technician_id is null or v_bps is null or v_bps < 1 or v_bps > 10000 then
      raise exception 'Invalid worker entry';
    end if;
    if not exists (select 1 from public.profiles where id = v_technician_id and role = 'tecnico' and is_active) then
      raise exception 'Worker is not an active technician';
    end if;
    v_total := v_total + v_bps;
  end loop;

  if v_total <> 10000 then
    raise exception 'Percentages must total 100';
  end if;

  insert into public.manual_jobs (prism_number, value_cents, status, created_by)
  values (v_prism, p_value_cents, 'pending', auth.uid())
  returning id into v_job_id;

  for v_worker in select * from jsonb_array_elements(p_workers) loop
    insert into public.manual_job_workers (manual_job_id, technician_id, percentage_basis_points)
    values (v_job_id, (v_worker->>'technicianId')::uuid, (v_worker->>'percentageBasisPoints')::integer);
  end loop;

  return v_job_id;
end;
$$;

create or replace function public.review_manual_job(p_manual_job_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;
  update public.manual_jobs
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = clock_timestamp(),
      rejection_reason = case when p_approve then null else nullif(btrim(coalesce(p_reason,'')),'') end,
      updated_at = clock_timestamp()
  where id = p_manual_job_id;
  if not found then
    raise exception 'Manual job unavailable';
  end if;
end;
$$;

create or replace function public.list_manual_jobs_for_office()
returns table(
  id uuid,
  prism_number text,
  value_cents bigint,
  status text,
  created_by uuid,
  creator_name text,
  reviewed_by uuid,
  reviewer_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz,
  workers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;
  return query
  select mj.id, mj.prism_number, mj.value_cents, mj.status, mj.created_by,
    coalesce(nullif(btrim(c.full_name), ''), c.email),
    mj.reviewed_by,
    coalesce(nullif(btrim(r.full_name), ''), r.email),
    mj.reviewed_at, mj.rejection_reason, mj.created_at,
    coalesce(w.workers, '[]'::jsonb)
  from public.manual_jobs mj
  join public.profiles c on c.id = mj.created_by
  left join public.profiles r on r.id = mj.reviewed_by
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'technicianId', mw.technician_id,
      'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
      'percentageBasisPoints', mw.percentage_basis_points
    ) order by mw.percentage_basis_points desc) as workers
    from public.manual_job_workers mw
    join public.profiles p on p.id = mw.technician_id
    where mw.manual_job_id = mj.id
  ) w on true
  order by case mj.status when 'pending' then 0 when 'approved' then 1 else 2 end, mj.created_at desc;
end;
$$;

create or replace function public.list_my_manual_jobs()
returns table(
  id uuid,
  prism_number text,
  value_cents bigint,
  status text,
  created_by uuid,
  creator_name text,
  reviewed_by uuid,
  reviewer_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz,
  workers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select mj.id, mj.prism_number, mj.value_cents, mj.status, mj.created_by,
    coalesce(nullif(btrim(c.full_name), ''), c.email),
    mj.reviewed_by,
    coalesce(nullif(btrim(r.full_name), ''), r.email),
    mj.reviewed_at, mj.rejection_reason, mj.created_at,
    coalesce(w.workers, '[]'::jsonb)
  from public.manual_jobs mj
  join public.profiles c on c.id = mj.created_by
  left join public.profiles r on r.id = mj.reviewed_by
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'technicianId', mw.technician_id,
      'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
      'percentageBasisPoints', mw.percentage_basis_points
    ) order by mw.percentage_basis_points desc) as workers
    from public.manual_job_workers mw
    join public.profiles p on p.id = mw.technician_id
    where mw.manual_job_id = mj.id
  ) w on true
  where mj.created_by = auth.uid()
  order by case mj.status when 'pending' then 0 when 'approved' then 1 else 2 end, mj.created_at desc;
end;
$$;

drop function if exists public.get_worker_weekly_financial_dashboard(timestamptz);

create or replace function public.get_worker_weekly_financial_dashboard(p_reference_at timestamptz default clock_timestamp())
returns table(
  participant_id uuid,
  allocated_cents bigint,
  allocation_count bigint,
  week_start_at timestamptz,
  week_end_exclusive_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  as_of timestamptz := coalesce(p_reference_at, clock_timestamp());
  local_date date := (as_of at time zone 'America/New_York')::date;
  start_date date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  start_date := local_date - ((extract(dow from local_date)::integer + 2) % 7);
  starts_at := start_date::timestamp at time zone 'America/New_York';
  ends_at := (start_date + 7)::timestamp at time zone 'America/New_York';
  return query
  select a.participant_id, sum(a.allocated_cents)::bigint, count(*)::bigint, starts_at, ends_at
  from public.job_delivery_financial_allocations a
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
    and v.superseded_at is null and v.voided_at is null
  join public.job_deliveries d on d.id = v.delivery_id
    and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = v.job_id and j.current_delivery_id = d.id
  where d.confirmed_at >= starts_at and d.confirmed_at < ends_at
  group by a.participant_id

  union all

  select mw.technician_id, sum(round((mw.percentage_basis_points * mj.value_cents) / 10000.0))::bigint, count(*)::bigint, starts_at, ends_at
  from public.manual_job_workers mw
  join public.manual_jobs mj on mj.id = mw.manual_job_id and mj.status = 'approved'
  where mj.reviewed_at >= starts_at and mj.reviewed_at < ends_at
  group by mw.technician_id;
end;
$$;

drop function if exists public.get_financial_history(date, date);

create or replace function public.get_financial_history(p_start_date date, p_end_date date)
returns table(bucket_date date, income_cents bigint, worker_expense_cents bigint, fuel_expense_cents bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366 then raise exception 'Invalid date range'; end if;
  return query
  with dates as (
    select generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day')::date as d
  ),
  income as (
    select (d.confirmed_at at time zone 'America/New_York')::date as d, coalesce(sum(v.source_amount_cents), 0)::bigint as cents
    from public.job_delivery_allocation_versions v
    join public.job_deliveries d on d.id = v.delivery_id and d.submitted and d.superseded_at is null
    where v.superseded_at is null and v.voided_at is null
      and (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ),
  worker_expense as (
    select (d.confirmed_at at time zone 'America/New_York')::date as d, coalesce(sum(a.allocated_cents), 0)::bigint as cents
    from public.job_delivery_financial_allocations a
    join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id and v.superseded_at is null and v.voided_at is null
    join public.job_deliveries d on d.id = v.delivery_id and d.submitted and d.superseded_at is null
    where (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ),
  fuel_expense as (
    select (s.started_at at time zone 'America/New_York')::date as d, coalesce((sum(s.fuel_amount) * 100)::bigint, 0)::bigint as cents
    from public.technician_shifts s
    where (s.started_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ),
  manual as (
    select (mj.reviewed_at at time zone 'America/New_York')::date as d,
           coalesce(sum(mj.value_cents), 0)::bigint as worker_cents
    from public.manual_jobs mj
    where mj.status = 'approved'
      and (mj.reviewed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  )
  select dates.d,
    coalesce(income.cents, 0) as income_cents,
    coalesce(worker_expense.cents, 0) + coalesce(manual.worker_cents, 0) as worker_expense_cents,
    coalesce(fuel_expense.cents, 0) as fuel_expense_cents
  from dates
  left join income on income.d = dates.d
  left join worker_expense on worker_expense.d = dates.d
  left join fuel_expense on fuel_expense.d = dates.d
  left join manual on manual.d = dates.d
  order by dates.d;
end;
$$;

revoke all on function public.create_manual_job(text, bigint, jsonb) from public;
revoke all on function public.review_manual_job(uuid, boolean, text) from public;
revoke all on function public.list_manual_jobs_for_office() from public;
revoke all on function public.list_my_manual_jobs() from public;
revoke all on function public.get_worker_weekly_financial_dashboard(timestamptz) from public;
revoke all on function public.get_financial_history(date, date) from public;
grant execute on function public.create_manual_job(text, bigint, jsonb) to authenticated;
grant execute on function public.review_manual_job(uuid, boolean, text) to authenticated;
grant execute on function public.list_manual_jobs_for_office() to authenticated;
grant execute on function public.list_my_manual_jobs() to authenticated;
grant execute on function public.get_worker_weekly_financial_dashboard(timestamptz) to authenticated;
grant execute on function public.get_financial_history(date, date) to authenticated;
