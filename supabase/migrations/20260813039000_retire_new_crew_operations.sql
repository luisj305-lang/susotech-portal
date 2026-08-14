-- Retire crew management and new crew assignment while preserving every
-- existing crew, membership and assignment row for historical readability.

drop policy if exists "Admins can manage crews" on public.crews;
drop policy if exists "Admins can manage crew members" on public.crew_members;
revoke insert, update, delete on public.crews from authenticated;
revoke insert, update, delete on public.crew_members from authenticated;

create or replace function public.validate_job_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_office_staff(auth.uid()) then raise exception 'Only active office staff can assign jobs'; end if;
    if new.assignee_type = 'crew' then raise exception 'New crew assignments are retired'; end if;
    new.assigned_by := auth.uid();
    new.assigned_at := clock_timestamp();
  elsif new.assigned_by is distinct from old.assigned_by
    or new.assigned_at is distinct from old.assigned_at
  then raise exception 'Assignment actor and date are immutable'; end if;

  if tg_op = 'UPDATE' and (
    new.job_id is distinct from old.job_id
    or new.assignee_type is distinct from old.assignee_type
    or new.technician_id is distinct from old.technician_id
    or new.crew_id is distinct from old.crew_id
  ) then raise exception 'Reassignment must preserve the previous assignment row'; end if;

  if tg_op = 'UPDATE' and old.assignee_type = 'crew' then
    if not (old.active and not new.active)
      or new.is_primary is distinct from old.is_primary
    then raise exception 'Retired crew assignments cannot be reactivated or modified; they can only be deactivated'; end if;
  end if;
  if new.active and new.assignee_type = 'technician'
    and not public.is_operational_worker(new.technician_id)
  then raise exception 'Assignee must be an active operational worker'; end if;
  return new;
end;
$$;

alter function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid)
  rename to assign_jobs_atomic_before_crew_retirement;
revoke all on function public.assign_jobs_atomic_before_crew_retirement(uuid[], public.assignee_type, uuid) from public;
revoke all on function public.assign_jobs_atomic_before_crew_retirement(uuid[], public.assignee_type, uuid) from authenticated;

create function public.assign_jobs_atomic(
  job_ids uuid[],
  new_assignee_type public.assignee_type default null,
  new_assignee_id uuid default null
)
returns setof public.job_assignments
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new_assignee_type = 'crew' then raise exception 'New crew assignments are retired'; end if;
  if new_assignee_type is not null and new_assignee_type <> 'technician' then
    raise exception 'Assignment type is unavailable';
  end if;
  return query select * from public.assign_jobs_atomic_before_crew_retirement(
    job_ids, new_assignee_type, new_assignee_id
  );
end;
$$;

alter function public.confirm_job_import_item(uuid, public.assignee_type, uuid)
  rename to confirm_job_import_item_before_crew_retirement;
revoke all on function public.confirm_job_import_item_before_crew_retirement(uuid, public.assignee_type, uuid) from public;
revoke all on function public.confirm_job_import_item_before_crew_retirement(uuid, public.assignee_type, uuid) from authenticated;

create function public.confirm_job_import_item(
  p_item_id uuid,
  p_assignee_type public.assignee_type default null,
  p_assignee_id uuid default null
)
returns table(result_status text, confirmed_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_assignee_type = 'crew' then raise exception 'New crew assignments are retired'; end if;
  if p_assignee_type is not null and p_assignee_type <> 'technician' then
    raise exception 'Assignment type is unavailable';
  end if;
  return query select * from public.confirm_job_import_item_before_crew_retirement(
    p_item_id, p_assignee_type, p_assignee_id
  );
end;
$$;

revoke all on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) from public;
revoke all on function public.confirm_job_import_item(uuid, public.assignee_type, uuid) from public;
grant execute on function public.assign_jobs_atomic(uuid[], public.assignee_type, uuid) to authenticated;
grant execute on function public.confirm_job_import_item(uuid, public.assignee_type, uuid) to authenticated;
