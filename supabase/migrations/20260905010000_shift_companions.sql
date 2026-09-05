-- Record who each technician starts a shift with, so those companions appear
-- ACTIVE on the operations dashboard. Recording companions is the technician's
-- responsibility and takes effect immediately with no companion confirmation.
-- Companions gain no job access, assignment responsibility, financial shares,
-- or duplicate fuel/vehicle attribution.

create table if not exists public.technician_shift_companions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.technician_shifts(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (shift_id, technician_id)
);

create index if not exists technician_shift_companions_technician_idx
  on public.technician_shift_companions (technician_id);

alter table public.technician_shift_companions enable row level security;

drop policy if exists "Technicians view own shift companions" on public.technician_shift_companions;
create policy "Technicians view own shift companions"
on public.technician_shift_companions for select to authenticated
using (public.is_technician() and recorded_by = auth.uid());

drop policy if exists "Office staff view shift companions" on public.technician_shift_companions;
create policy "Office staff view shift companions"
on public.technician_shift_companions for select to authenticated
using (public.is_office_staff());

revoke insert, update, delete on public.technician_shift_companions from authenticated;
grant select on public.technician_shift_companions to authenticated;

-- The companion-aware shift start replaces the previous three-argument
-- overload; dropping it avoids PostgREST overload ambiguity when callers omit
-- the optional companion argument.
drop function if exists public.start_technician_shift(boolean, numeric, text);

create or replace function public.start_technician_shift(
  p_no_fuel_today boolean,
  p_fuel_amount numeric,
  p_fuel_photo_path text default null,
  p_companion_ids uuid[] default null
)
returns table(
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  fuel_amount numeric,
  no_fuel_today boolean,
  fuel_photo_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  begins_at timestamptz := now();
  ends_at timestamptz := now() + interval '10 hours';
  clean_photo_path text := nullif(btrim(p_fuel_photo_path), '');
  new_shift_id uuid;
  primary_vehicle_id uuid;
begin
  if not public.is_technician(actor) then
    raise exception 'Active technician required';
  end if;
  if p_no_fuel_today is null or p_fuel_amount is null
    or p_fuel_amount < 0
    or p_fuel_amount > 9999999999.99
    or p_fuel_amount <> round(p_fuel_amount, 2)
    or (p_no_fuel_today and (p_fuel_amount <> 0 or clean_photo_path is not null))
    or (not p_no_fuel_today and p_fuel_amount <= 0)
  then
    raise exception 'Invalid fuel information';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('technician-shift:' || actor::text, 0)
  );

  if exists (
    select 1 from public.technician_shifts s
    where s.technician_id = actor
      and s.started_at <= begins_at
      and s.active_until > begins_at
  ) then
    raise exception 'An active shift already exists';
  end if;

  if clean_photo_path is not null then
    if clean_photo_path !~ (
      '^' || actor::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
    ) or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'technician-shift-fuel'
        and o.name = clean_photo_path
        and lower(coalesce(o.metadata ->> 'mimetype', '')) in (
          'image/jpeg', 'image/png', 'image/webp'
        )
        and coalesce((o.metadata ->> 'size')::bigint, 0) between 1 and 10485760
    ) then
      raise exception 'Invalid fuel photo';
    end if;
  end if;

  select a.vehicle_id
  into primary_vehicle_id
  from public.fleet_vehicle_assignments a
  where a.technician_id = actor
    and a.assignment_role = 'primary'
    and a.starts_on <= current_date
    and (a.ends_on is null or a.ends_on >= current_date)
  order by a.starts_on desc, a.created_at desc
  limit 1;

  insert into public.technician_shifts (
    technician_id, vehicle_id, started_at, active_until, fuel_amount,
    no_fuel_today, fuel_photo_path, created_by
  ) values (
    actor, primary_vehicle_id, begins_at, ends_at, p_fuel_amount,
    p_no_fuel_today, clean_photo_path, actor
  ) returning id into new_shift_id;

  if p_companion_ids is not null then
    if cardinality(p_companion_ids) > 20 then
      raise exception 'Too many companions';
    end if;

    if exists (
      select 1
      from unnest(p_companion_ids) as c(id)
      where c.id is null
         or not exists (
           select 1 from public.profiles p
           where p.id = c.id and p.role = 'tecnico' and p.is_active
         )
    ) then
      raise exception 'Invalid companion';
    end if;

    insert into public.technician_shift_companions (shift_id, technician_id, recorded_by)
    select new_shift_id, c.id, actor
    from (select distinct unnest(p_companion_ids) as id) c
    where c.id <> actor;
  end if;

  return query
  select s.id, s.started_at, s.active_until, s.fuel_amount,
    s.no_fuel_today, s.fuel_photo_path
  from public.technician_shifts s where s.id = new_shift_id;
end;
$$;

comment on function public.start_technician_shift(boolean, numeric, text, uuid[]) is
  'Starts a technician shift, snapshots the current primary vehicle, and records start-of-shift companions.';

create or replace function public.get_worker_operations_dashboard(
  p_reference_at timestamptz default clock_timestamp()
)
returns table(
  technician_id uuid,
  technician_name text,
  crew_names text[],
  is_shift_active boolean,
  shift_started_at timestamptz,
  shift_active_until timestamptz,
  weekly_production numeric,
  weekly_production_amount numeric,
  weekly_production_company_amount numeric,
  weekly_delivered_jobs bigint,
  weekly_fuel_amount numeric,
  fuel_daily jsonb,
  production_breakdown jsonb,
  server_now timestamptz,
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
  local_date date;
  start_date date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  local_date := (as_of at time zone 'America/New_York')::date;
  start_date := local_date - ((extract(dow from local_date)::integer + 2) % 7);
  starts_at := start_date::timestamp at time zone 'America/New_York';
  ends_at := (start_date + 7)::timestamp at time zone 'America/New_York';

  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    coalesce(crews.names, '{}'::text[]),
    coalesce(latest.started_at <= as_of and latest.active_until > as_of, false)
      or coalesce(companion_active.active, false),
    latest.started_at, latest.active_until,
    coalesce(production.total_quantity, 0)::numeric,
    coalesce(production.total_amount, 0)::numeric,
    coalesce(production.total_company_amount, 0)::numeric,
    coalesce(delivered.delivered_jobs, 0)::bigint,
    coalesce(fuel.total_amount, 0)::numeric,
    coalesce(fuel_daily.items, '[]'::jsonb),
    coalesce(breakdown.items, '[]'::jsonb),
    as_of, starts_at, ends_at
  from public.profiles p
  left join lateral (
    select array_agg(distinct c.name order by c.name) as names
    from public.crews c
    left join public.crew_members cm on cm.crew_id = c.id
    where c.is_active and (c.lead_technician_id = p.id or cm.technician_id = p.id)
  ) crews on true
  left join lateral (
    select s.started_at, s.active_until
    from public.technician_shifts s
    where s.technician_id = p.id
    order by s.started_at desc limit 1
  ) latest on true
  left join lateral (
    select exists (
      select 1 from public.technician_shift_companions c
      join public.technician_shifts s on s.id = c.shift_id
      where c.technician_id = p.id
        and s.started_at <= as_of
        and s.active_until > as_of
    ) as active
  ) companion_active on true
  left join lateral (
    select
      sum(l.quantity) as total_quantity,
      sum(l.amount_snapshot) as total_amount,
      sum(l.quantity * coalesce(cr.unit_price, 0)) as total_company_amount
    from public.job_delivery_production_lines l
    join public.job_deliveries d on d.id = l.delivery_id
    left join lateral (
      select r.unit_price
      from public.production_code_rates r
      join public.price_categories pc on pc.id = r.price_category_id
      where pc.slug = 'company'
        and r.active
        and r.effective_from <= current_date
        and r.catalog_item_id = l.catalog_item_id
      order by r.effective_from desc
      limit 1
    ) cr on true
    where l.credited_technician_id = p.id
      and d.submitted and d.superseded_at is null
      and l.credited_at >= starts_at and l.credited_at < ends_at
  ) production on true
  left join lateral (
    select count(distinct d.job_id) as delivered_jobs
    from public.job_deliveries d
    where d.delivered_by = p.id
      and d.submitted and d.superseded_at is null
      and d.confirmed_at >= starts_at and d.confirmed_at < ends_at
  ) delivered on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', grouped.code, 'unit', grouped.unit_snapshot,
      'quantity', grouped.quantity
    ) order by grouped.code, grouped.unit_snapshot) as items
    from (
      select l.code, l.unit_snapshot, sum(l.quantity) as quantity
      from public.job_delivery_production_lines l
      join public.job_deliveries d on d.id = l.delivery_id
      where l.credited_technician_id = p.id
        and d.submitted and d.superseded_at is null
        and l.credited_at >= starts_at and l.credited_at < ends_at
      group by l.code, l.unit_snapshot
    ) grouped
  ) breakdown on true
  left join lateral (
    select sum(s.fuel_amount) as total_amount
    from public.technician_shifts s
    where s.technician_id = p.id
      and s.started_at >= starts_at and s.started_at < ends_at
  ) fuel on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'date', (s.started_at at time zone 'America/New_York')::date,
      'amount', s.fuel_amount,
      'no_fuel', coalesce(s.no_fuel_today, false)
    ) order by s.started_at) as items
    from public.technician_shifts s
    where s.technician_id = p.id
      and s.started_at >= starts_at and s.started_at < ends_at
  ) fuel_daily on true
  where p.role = 'tecnico' and p.is_active
  order by coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

revoke all on function public.start_technician_shift(boolean, numeric, text, uuid[]) from public;
revoke all on function public.get_worker_operations_dashboard(timestamptz) from public;
grant execute on function public.start_technician_shift(boolean, numeric, text, uuid[]) to authenticated;
grant execute on function public.get_worker_operations_dashboard(timestamptz) to authenticated;
