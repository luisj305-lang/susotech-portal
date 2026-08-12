alter table public.jobs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id),
  add column if not exists archive_reason text;

create index if not exists jobs_active_updated_idx
  on public.jobs (updated_at desc)
  where archived_at is null;

drop policy if exists "Office staff can manage jobs" on public.jobs;
drop policy if exists "Office staff can view jobs" on public.jobs;
drop policy if exists "Office staff can create jobs" on public.jobs;
drop policy if exists "Office staff can update jobs" on public.jobs;
drop policy if exists "Admins can delete jobs" on public.jobs;

create policy "Office staff can view jobs"
on public.jobs for select to authenticated
using (public.is_office_staff());

create policy "Office staff can create jobs"
on public.jobs for insert to authenticated
with check (public.is_office_staff());

create policy "Office staff can update jobs"
on public.jobs for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Admins can delete jobs"
on public.jobs for delete to authenticated
using (public.is_admin());

create or replace function public.can_access_job(
  check_job_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_office_staff(check_user_id)
    or (
      public.is_technician(check_user_id)
      and exists (
        select 1
        from public.jobs j
        join public.job_assignments ja on ja.job_id = j.id
        where j.id = check_job_id
          and j.archived_at is null
          and ja.active
          and (
            (ja.assignee_type = 'technician' and ja.technician_id = check_user_id)
            or (
              ja.assignee_type = 'crew'
              and exists (
                select 1 from public.crews c
                where c.id = ja.crew_id
                  and c.is_active
                  and (
                    c.lead_technician_id = check_user_id
                    or exists (
                      select 1 from public.crew_members cm
                      where cm.crew_id = c.id and cm.technician_id = check_user_id
                    )
                  )
              )
            )
          )
      )
    );
$$;

create or replace function public.set_job_archived(
  p_job_id uuid,
  p_archived boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if not public.is_admin(actor) then
    raise exception 'Admin access required';
  end if;

  if p_archived and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Archive reason required';
  end if;

  update public.jobs
  set archived_at = case when p_archived then now() else null end,
      archived_by = case when p_archived then actor else null end,
      archive_reason = case when p_archived then left(btrim(p_reason), 1000) else null end,
      updated_at = now()
  where id = p_job_id;

  if not found then raise exception 'Job unavailable'; end if;
end;
$$;

revoke all on function public.set_job_archived(uuid, boolean, text) from public;
grant execute on function public.set_job_archived(uuid, boolean, text) to authenticated;
