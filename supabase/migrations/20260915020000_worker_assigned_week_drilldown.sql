-- Add a required-bounds overload; keep the one-argument RPC unchanged.
-- Membership uses the same active primary assignment that associates the worker.
create or replace function public.list_technician_assigned_jobs(
  p_technician_id uuid,
  p_week_start_at timestamptz,
  p_week_end_exclusive_at timestamptz
)
returns table(
  id uuid,
  prism_number text,
  title text,
  address text,
  main_status text,
  deadline_date timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
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
  if p_technician_id is null
    or p_week_start_at is null or p_week_end_exclusive_at is null
    or not isfinite(p_week_start_at) or not isfinite(p_week_end_exclusive_at)
    or extract(dow from p_week_start_at at time zone 'America/New_York') <> 5
    or (p_week_start_at at time zone 'America/New_York')::time <> time '00:00:00'
    or p_week_end_exclusive_at <> (
      (p_week_start_at at time zone 'America/New_York') + interval '7 days'
    ) at time zone 'America/New_York'
  then
    raise exception 'Invalid worker assignment week';
  end if;

  return query
  select j.id, j.prism_number, j.title, j.address, j.main_status::text, j.deadline_date, j.updated_at, j.archived_at
  from public.jobs j
  join public.job_assignments ja on ja.job_id = j.id and ja.active and ja.is_primary
  where ja.assigned_at >= p_week_start_at
    and ja.assigned_at < p_week_end_exclusive_at
    and (
      (ja.assignee_type = 'technician' and ja.technician_id = p_technician_id)
      or (
        ja.assignee_type = 'crew' and exists (
          select 1 from public.crews c
          where c.id = ja.crew_id and c.is_active
            and (c.lead_technician_id = p_technician_id or exists (
              select 1 from public.crew_members cm
              where cm.crew_id = c.id and cm.technician_id = p_technician_id
            ))
        )
      )
    )
  order by j.updated_at desc;
end;
$$;

revoke all on function public.list_technician_assigned_jobs(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.list_technician_assigned_jobs(uuid, timestamptz, timestamptz) to authenticated;
