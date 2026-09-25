-- Manual work remains outside the regular jobs lifecycle. These read models
-- expose only a listed technician's own manual share and make approved manual
-- shares a separate weekly earnings source.

create or replace function public.list_my_manual_jobs()
returns table(
  id uuid,
  prism_number text,
  value_cents bigint,
  status text,
  created_by uuid,
  creator_name text,
  reviewed_by uuid,
  reviewer_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz,
  pdf_path text,
  workers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then return; end if;

  return query
  select mj.id, mj.prism_number, mj.value_cents, mj.status, mj.created_by,
    coalesce(nullif(btrim(c.full_name), ''), c.email),
    mj.reviewed_by,
    coalesce(nullif(btrim(r.full_name), ''), r.email),
    mj.reviewed_at, mj.rejection_reason, mj.created_at, mj.pdf_path,
    coalesce(w.workers, '[]'::jsonb)
  from public.manual_jobs mj
  join public.profiles c on c.id = mj.created_by
  left join public.profiles r on r.id = mj.reviewed_by
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'technicianId', mw.technician_id,
      'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
      'percentageBasisPoints', mw.percentage_basis_points,
      'allocatedCents', round((mj.value_cents * mw.percentage_basis_points) / 10000.0)::bigint
    ) order by mw.percentage_basis_points desc, mw.technician_id) as workers
    from public.manual_job_workers mw
    join public.profiles p on p.id = mw.technician_id
    where mw.manual_job_id = mj.id
      and (mj.created_by = actor or mw.technician_id = actor)
  ) w on true
  where mj.created_by = actor
    or exists (
      select 1
      from public.manual_job_workers own_share
      where own_share.manual_job_id = mj.id
        and own_share.technician_id = actor
    )
  order by case mj.status when 'pending' then 0 when 'approved' then 1 else 2 end, mj.created_at desc;
end;
$$;

create or replace function public.get_my_weekly_manual_earnings(p_reference_date date default null)
returns table(
  week_start date,
  week_end_exclusive date,
  approval_date date,
  manual_job_id uuid,
  prism_number text,
  source_amount_cents bigint,
  percentage_basis_points integer,
  allocated_cents bigint,
  review_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  reference_date date := coalesce(p_reference_date, (clock_timestamp() at time zone 'America/New_York')::date);
  starts_on date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_field_worker(auth.uid()) then return; end if;

  starts_on := reference_date - ((extract(dow from reference_date)::integer + 2) % 7);
  starts_at := starts_on::timestamp at time zone 'America/New_York';
  ends_at := (starts_on + 7)::timestamp at time zone 'America/New_York';

  return query
  select starts_on,
    starts_on + 7,
    (mj.reviewed_at at time zone 'America/New_York')::date,
    mj.id,
    mj.prism_number,
    mj.value_cents,
    mw.percentage_basis_points,
    round((mj.value_cents * mw.percentage_basis_points) / 10000.0)::bigint,
    'approved'::text
  from public.manual_job_workers mw
  join public.manual_jobs mj on mj.id = mw.manual_job_id
  where mw.technician_id = auth.uid()
    and mj.status = 'approved'
    and mj.reviewed_at >= starts_at
    and mj.reviewed_at < ends_at
  order by mj.reviewed_at, mj.prism_number, mj.id;
end;
$$;

-- A work participant is created by a submitted delivery allocation. The
-- current submitted delivery condition prevents saved allocation drafts from
-- granting either read access or an informational participation record.
create or replace function public.get_my_job_work_participation(p_job_id uuid)
returns table(informational_basis_points integer)
language sql
stable
security definer
set search_path = ''
as $$
  select wp.informational_basis_points
  from public.job_work_participants wp
  join public.jobs j on j.id = wp.job_id and j.archived_at is null
  join public.job_deliveries d on d.id = j.current_delivery_id
    and d.submitted and d.superseded_at is null
  where wp.job_id = p_job_id
    and wp.technician_id = auth.uid()
    and wp.informational_basis_points is not null
    and public.is_field_worker(auth.uid());
$$;

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

  if exists (
    select 1
    from public.jobs j
    join public.job_deliveries d on d.id = j.current_delivery_id
      and d.submitted and d.superseded_at is null
    join public.job_work_participants wp on wp.job_id = j.id
      and wp.technician_id = check_user_id
      and wp.informational_basis_points is not null
    where j.id = check_job_id and j.archived_at is null
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

-- Read participation must not become an operational assignment. Keep all job
-- writes on the assignment and active-shift boundary, independent of can_view_job.
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

-- Remove both implicit PUBLIC and explicit anonymous execution. Replacing the
-- existing functions preserves their established service_role grants; new read
-- RPCs receive no service_role grant because they have no operational caller.
revoke all on function public.list_my_manual_jobs() from public, anon;
revoke all on function public.get_my_weekly_manual_earnings(date) from public, anon;
revoke all on function public.get_my_job_work_participation(uuid) from public, anon;
revoke all on function public.can_view_job(uuid, uuid) from public, anon;
revoke all on function public.can_mutate_job(uuid, uuid) from public, anon;
grant execute on function public.list_my_manual_jobs() to authenticated;
grant execute on function public.get_my_weekly_manual_earnings(date) to authenticated;
grant execute on function public.get_my_job_work_participation(uuid) to authenticated;
grant execute on function public.can_view_job(uuid, uuid) to authenticated;
grant execute on function public.can_mutate_job(uuid, uuid) to authenticated;
