-- Weekly export for technicians: their previous-week deliveries (Friday-Thursday)
-- with the full participant split. The viewer must be one of the delivery's
-- financial participants; only those deliveries are returned (never coworkers on
-- jobs the viewer is not part of). The total amount (source_amount_cents) and the
-- sum of the participant shares reconcile because every participant row of a
-- delivery carries the same source amount.

create or replace function public.get_my_weekly_export(p_reference_date date default null)
returns table(
  week_start date,
  week_end date,
  job_id uuid,
  delivery_id uuid,
  prism_number text,
  source_amount_cents bigint,
  participant_name text,
  worker_specialty text,
  percentage_basis_points integer,
  allocated_cents bigint,
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
  ), viewer_versions as (
    select distinct v.id as allocation_version_id
    from week w
    join public.job_delivery_financial_allocations a on a.participant_id = auth.uid()
    join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
      and v.superseded_at is null and v.voided_at is null
    join public.job_deliveries d on d.id = v.delivery_id
      and d.submitted and d.superseded_at is null
    join public.jobs j on j.id = v.job_id and j.current_delivery_id = d.id
    where (d.confirmed_at at time zone 'America/New_York')::date between w.starts and w.starts + 6
  )
  select w.starts, w.starts + 6,
    v.job_id, v.delivery_id, j.prism_number,
    v.source_amount_cents,
    a.participant_name_snapshot, a.worker_specialty_snapshot,
    a.percentage_basis_points, a.allocated_cents,
    case when j.main_status in ('aprobado','facturado','pagado')
      then 'confirmed' else 'pending' end
  from week w
  join viewer_versions vv on true
  join public.job_delivery_allocation_versions v on v.id = vv.allocation_version_id
  join public.job_delivery_financial_allocations a on a.allocation_version_id = v.id
  join public.job_deliveries d on d.id = v.delivery_id
  join public.jobs j on j.id = v.job_id
  where public.is_field_worker(auth.uid())
  order by (d.confirmed_at at time zone 'America/New_York')::date, j.prism_number, a.participant_name_snapshot, v.job_id;
$$;

revoke all on function public.get_my_weekly_export(date) from public;
grant execute on function public.get_my_weekly_export(date) to authenticated;
