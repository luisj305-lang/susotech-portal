-- Office staff (admin + supervisor) can inspect the full financial split
-- (technician + helper) for a specific job when invoicing. Mirrors
-- list_my_financial_allocations but returns every participant and is gated
-- to office staff.

create or replace function public.list_job_financial_allocations(p_job_id uuid)
returns table(
  allocation_version_id uuid,
  delivery_id uuid,
  job_id uuid,
  version integer,
  participant_id uuid,
  percentage_basis_points integer,
  allocated_cents bigint,
  source_amount_cents bigint,
  participant_name text,
  worker_specialty text,
  created_at timestamptz,
  is_current boolean,
  state text
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
  select v.id, v.delivery_id, v.job_id, v.version,
    a.participant_id,
    a.percentage_basis_points, a.allocated_cents, v.source_amount_cents,
    a.participant_name_snapshot, a.worker_specialty_snapshot, v.created_at,
    (j.current_delivery_id = v.delivery_id and d.superseded_at is null
      and v.superseded_at is null and v.voided_at is null),
    case when v.voided_at is not null then 'voided'
      when v.superseded_at is not null then 'superseded'
      else 'current' end
  from public.job_delivery_financial_allocations a
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
  join public.job_deliveries d on d.id = v.delivery_id
  join public.jobs j on j.id = v.job_id
  where v.job_id = p_job_id
  order by v.created_at desc, v.version desc, a.allocation_order;
end;
$$;

revoke all on function public.list_job_financial_allocations(uuid) from public;
grant execute on function public.list_job_financial_allocations(uuid) to authenticated;
