-- Atomic direct/crew reassignment for office server actions.
create or replace function public.assign_jobs_atomic(
  job_ids uuid[],
  new_assignee_type public.assignee_type,
  new_assignee_id uuid
)
returns setof public.job_assignments
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_office_staff() then
    raise exception 'Only active office staff can assign jobs';
  end if;
  if coalesce(array_length(job_ids, 1), 0) = 0 or array_length(job_ids, 1) > 100 then
    raise exception 'One to 100 jobs are required';
  end if;
  if (select count(*) from public.jobs where id = any(job_ids)) <> array_length(job_ids, 1) then
    raise exception 'One or more jobs are unavailable';
  end if;

  update public.job_assignments
  set active = false, is_primary = false
  where job_id = any(job_ids) and active and is_primary;

  return query
  insert into public.job_assignments (
    job_id, assignee_type, technician_id, crew_id, assigned_by
  )
  select id, new_assignee_type,
    case when new_assignee_type = 'technician' then new_assignee_id end,
    case when new_assignee_type = 'crew' then new_assignee_id end,
    auth.uid()
  from public.jobs where id = any(job_ids)
  returning *;

  insert into public.job_status_history (
    job_id, previous_status, new_status, previous_incident, new_incident, changed_by, notes
  )
  select id, main_status, main_status, incident, incident, auth.uid(), 'Assignment updated'
  from public.jobs where id = any(job_ids);
end;
$$;

revoke all on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) from public;
grant execute on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) to authenticated;
