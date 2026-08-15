-- A work shift records attendance and fuel; it is not an authorization boundary.
-- Keep this compatibility function because existing RPCs and triggers call it.
create or replace function public.require_active_technician_shift(
  check_user_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if check_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = check_user_id
      and p.is_active
  ) then
    raise exception 'Profile unavailable';
  end if;
end;
$$;

comment on function public.require_active_technician_shift(uuid) is
  'Compatibility authorization hook. Technician shifts are optional attendance/fuel records.';

drop policy if exists "Technicians can view their assignments"
on public.job_assignments;

create policy "Technicians can view their assignments"
on public.job_assignments for select
to authenticated
using (
  public.is_technician()
  and active
  and (
    (assignee_type = 'technician' and technician_id = auth.uid())
    or (assignee_type = 'crew' and public.can_access_crew(crew_id))
  )
);
