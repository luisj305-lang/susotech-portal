-- Punto 2: exponer el valor monetario (trabajador y compañía) de la producción semanal.
drop function if exists public.get_worker_operations_dashboard(timestamptz) cascade;

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
    coalesce(latest.started_at <= as_of and latest.active_until > as_of, false),
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
