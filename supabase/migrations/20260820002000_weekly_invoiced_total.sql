-- Punto 6/7: exponer el total facturado de la semana (precios del admin = source_amount_cents).
create or replace function public.get_weekly_invoiced_total(
  p_reference_at timestamptz default clock_timestamp()
)
returns table(invoiced_cents bigint, delivered_jobs bigint)
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
  select
    coalesce(sum(v.source_amount_cents), 0)::bigint,
    count(distinct d.job_id)::bigint
  from public.job_deliveries d
  join public.job_delivery_allocation_versions v
    on v.delivery_id = d.id
    and v.superseded_at is null and v.voided_at is null
  where d.submitted and d.superseded_at is null
    and d.confirmed_at >= starts_at and d.confirmed_at < ends_at;
end;
$$;

revoke all on function public.get_weekly_invoiced_total(timestamptz) from public;
grant execute on function public.get_weekly_invoiced_total(timestamptz) to authenticated;
