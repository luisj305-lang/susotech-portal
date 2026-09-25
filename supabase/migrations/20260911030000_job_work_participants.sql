-- Mixed financial-allocation roster: records who participated in a job,
-- independent of the money-owning delivery allocation versions.
--
-- Percentage participants also appear in job_delivery_financial_allocations;
-- hourly participants appear here only (paid from payroll, never from the job
-- allocation). informational_basis_points is an optional reference share for
-- hourly participants and never pays money.
--
-- This file is additive only: it creates a new table, index, read-only RLS
-- policies, and one office-guarded RPC. Nothing existing is dropped or
-- rewritten, and technicians never gain mutation rights here.

create table public.job_work_participants (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  informational_basis_points integer
    constraint job_work_participants_informational_basis_points_check
    check (informational_basis_points is null or informational_basis_points between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, technician_id)
);

create index job_work_participants_job_id_idx
  on public.job_work_participants(job_id);

alter table public.job_work_participants enable row level security;

create policy "Office staff view job work participants"
on public.job_work_participants for select to authenticated
using (public.is_office_staff());

create policy "Technicians view job work participants for accessible jobs"
on public.job_work_participants for select to authenticated
using (public.is_technician() and public.can_access_job(job_id, auth.uid()));

grant select on public.job_work_participants to authenticated;
revoke insert, update, delete on public.job_work_participants from authenticated;

-- Replace the participant roster for a job atomically (delete + insert in a
-- single transaction). Office staff only. Participants must be active
-- technicians; the optional informational basis points array, when supplied,
-- must match the participant ids one-to-one.
create or replace function public.set_job_work_participants(
  p_job_id uuid,
  p_participant_ids uuid[],
  p_informational_basis_points integer[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  selected_job public.jobs%rowtype;
  provided_count integer := coalesce(cardinality(p_participant_ids), 0);
begin
  if actor is null or not public.is_office_staff(actor) then
    raise exception 'Office access required';
  end if;

  select * into selected_job from public.jobs where id = p_job_id for update;
  if selected_job.id is null then raise exception 'Job unavailable'; end if;

  if p_informational_basis_points is not null
    and cardinality(p_informational_basis_points) <> provided_count
  then raise exception 'Informational basis points must match participants'; end if;

  if provided_count > 0 then
    if (select count(distinct participant_id)
        from unnest(p_participant_ids) u(participant_id)) <> provided_count
    then raise exception 'Duplicate participants'; end if;

    if exists (
      select 1
      from unnest(p_participant_ids) u(participant_id)
      left join public.profiles p on p.id = u.participant_id
        and p.role = 'tecnico' and p.is_active
      where p.id is null
    ) then raise exception 'Every participant must be an active technician'; end if;

    if p_informational_basis_points is not null and exists (
      select 1 from unnest(p_informational_basis_points) u(basis_points)
      where basis_points is not null and basis_points not between 0 and 10000
    ) then raise exception 'Informational basis points must be between 0 and 10000'; end if;
  end if;

  delete from public.job_work_participants where job_id = p_job_id;

  insert into public.job_work_participants(
    job_id, technician_id, recorded_by, informational_basis_points
  )
  select p_job_id, u.participant_id, actor,
    case when p_informational_basis_points is null then null
         else p_informational_basis_points[u.ord] end
  from unnest(p_participant_ids) with ordinality u(participant_id, ord);
end;
$$;

revoke all on function public.set_job_work_participants(uuid, uuid[], integer[]) from public;
grant execute on function public.set_job_work_participants(uuid, uuid[], integer[]) to authenticated;
