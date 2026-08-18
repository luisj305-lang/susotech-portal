-- Fix: jobs.deadline_date is timestamptz, not date. The previous signature
-- declared `date`, which made the function error with "structure of query does
-- not match function result type".

drop function if exists public.list_technician_assigned_jobs(uuid);

create function public.list_technician_assigned_jobs(p_technician_id uuid)
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
  return query
  select j.id, j.prism_number, j.title, j.address, j.main_status::text, j.deadline_date, j.updated_at, j.archived_at
  from public.jobs j
  join public.job_assignments ja on ja.job_id = j.id and ja.active and ja.is_primary
  where (
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

revoke all on function public.list_technician_assigned_jobs(uuid) from public;
grant execute on function public.list_technician_assigned_jobs(uuid) to authenticated;
