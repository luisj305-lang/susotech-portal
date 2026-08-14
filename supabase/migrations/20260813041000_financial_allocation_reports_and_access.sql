-- Participation grants read-only job visibility without becoming an operational
-- assignment. Operational mutation remains assignment- and shift-bound.

create or replace function public.can_view_job(
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
  if not public.is_field_worker(check_user_id) then return false; end if;

  if exists (
    select 1
    from public.jobs j
    join public.job_deliveries d on d.id = j.current_delivery_id
    join public.job_delivery_allocation_versions v on v.delivery_id = d.id
      and v.superseded_at is null and v.voided_at is null
    join public.job_delivery_financial_allocations a on a.allocation_version_id = v.id
    where j.id = check_job_id and j.archived_at is null
      and d.submitted and d.superseded_at is null
      and a.participant_id = check_user_id
  ) then return true; end if;

  if not public.is_operational_worker(check_user_id) then return false; end if;
  perform public.require_active_technician_shift(check_user_id);
  return exists (
    select 1
    from public.jobs j
    join public.job_assignments ja on ja.job_id = j.id
    where j.id = check_job_id and j.archived_at is null and ja.active
      and (
        (ja.assignee_type = 'technician' and ja.technician_id = check_user_id)
        or (
          ja.assignee_type = 'crew' and exists (
            select 1 from public.crews c
            where c.id = ja.crew_id and c.is_active
              and (c.lead_technician_id = check_user_id or exists (
                select 1 from public.crew_members cm
                where cm.crew_id = c.id and cm.technician_id = check_user_id
              ))
          )
        )
      )
  );
end;
$$;

create or replace function public.can_mutate_job(
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
  if not public.is_operational_worker(check_user_id) then return false; end if;
  perform public.require_active_technician_shift(check_user_id);
  return exists (
    select 1
    from public.jobs j
    join public.job_assignments ja on ja.job_id = j.id
    where j.id = check_job_id and j.archived_at is null and ja.active
      and (
        (ja.assignee_type = 'technician' and ja.technician_id = check_user_id)
        or (
          ja.assignee_type = 'crew' and exists (
            select 1 from public.crews c
            where c.id = ja.crew_id and c.is_active
              and (c.lead_technician_id = check_user_id or exists (
                select 1 from public.crew_members cm
                where cm.crew_id = c.id and cm.technician_id = check_user_id
              ))
          )
        )
      )
  );
end;
$$;

create or replace function public.list_my_financial_allocations(p_job_id uuid default null)
returns table(
  allocation_version_id uuid,
  delivery_id uuid,
  job_id uuid,
  version integer,
  percentage_basis_points integer,
  allocated_cents bigint,
  source_amount_cents bigint,
  participant_name text,
  worker_specialty text,
  created_at timestamptz,
  is_current boolean,
  state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.delivery_id, v.job_id, v.version,
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
  where a.participant_id = auth.uid()
    and (p_job_id is null or v.job_id = p_job_id)
    and public.is_field_worker(auth.uid())
  order by v.created_at desc, v.version desc;
$$;

create or replace function public.list_delivery_allocation_participants()
returns table(id uuid, label text, worker_specialty text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_operational_worker(auth.uid()) then
    raise exception 'Operational worker required';
  end if;
  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.worker_specialty
  from public.profiles p
  where p.role = 'tecnico' and p.is_active
    and p.worker_specialty in ('tecnico', 'splicer', 'liner', 'ayudante')
  order by 2, p.id;
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
    case when j.main_status in ('aprobado', 'listo_pagar', 'pagado')
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
    case when j.main_status in ('aprobado', 'listo_pagar', 'pagado')
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
  group by a.participant_id;
end;
$$;

revoke all on function public.list_my_financial_allocations(uuid) from public;
revoke all on function public.list_delivery_allocation_participants() from public;
revoke all on function public.get_my_weekly_financial_allocations(date) from public;
revoke all on function public.get_financial_allocation_report(date, date) from public;
revoke all on function public.get_worker_weekly_financial_dashboard(timestamptz) from public;
grant execute on function public.list_my_financial_allocations(uuid) to authenticated;
grant execute on function public.list_delivery_allocation_participants() to authenticated;
grant execute on function public.get_my_weekly_financial_allocations(date) to authenticated;
grant execute on function public.get_financial_allocation_report(date, date) to authenticated;
grant execute on function public.get_worker_weekly_financial_dashboard(timestamptz) to authenticated;
