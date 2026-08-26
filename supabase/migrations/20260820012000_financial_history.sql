-- Financial history: daily income, worker expense, and fuel expense buckets
-- for the "Históricos de gastos e ingresos" admin section.

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
  )
  select dates.d,
    coalesce(income.cents, 0) as income_cents,
    coalesce(worker_expense.cents, 0) as worker_expense_cents,
    coalesce(fuel_expense.cents, 0) as fuel_expense_cents
  from dates
  left join income on income.d = dates.d
  left join worker_expense on worker_expense.d = dates.d
  left join fuel_expense on fuel_expense.d = dates.d
  order by dates.d;
end;
$$;

revoke all on function public.get_financial_history(date, date) from public;
grant execute on function public.get_financial_history(date, date) to authenticated;
