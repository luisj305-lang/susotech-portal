-- Office-side hourly payroll controls (Work Unit 5a of the hourly payroll
-- plan): compensation configuration, weekly approval, and shift correction.
--
-- This migration is additive only: it creates three security-definer RPCs and
-- grants execute to authenticated. Nothing is dropped, and no table, column,
-- index, or constraint is modified. Hourly mode remains an optional
-- attendance/fuel record — it never changes job access, RLS boundaries, or
-- technician capabilities.
--
-- Approved pay periods are immutable: `approve_hourly_pay_period_record` can
-- only move a pending record to approved, and `correct_hourly_shift` refuses to
-- touch any shift whose period has already been approved.

-- ---------------------------------------------------------------------------
-- 1. set_technician_compensation
--    Configure a technician's pay mode and, for hourly mode, their hourly rate.
--    Percentage mode stores a null rate. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.set_technician_compensation(
  p_technician_id uuid,
  p_mode text,
  p_hourly_rate_cents bigint
)
returns table(
  technician_id uuid,
  mode text,
  hourly_rate_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_rate bigint := null;
begin
  if not public.is_admin(actor) then
    raise exception 'Admin access required';
  end if;

  if p_mode not in ('percentage', 'hourly') then
    raise exception 'Invalid compensation mode';
  end if;

  if p_mode = 'hourly' and coalesce(p_hourly_rate_cents, 0) <= 0 then
    raise exception 'Hourly rate required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_technician_id and p.role = 'tecnico' and p.is_active
  ) then
    raise exception 'Active technician required';
  end if;

  v_rate := case when p_mode = 'hourly' then p_hourly_rate_cents else null end;

  return query
  insert into public.technician_compensation_settings (
    technician_id, mode, hourly_rate_cents, changed_by, changed_at
  ) values (
    p_technician_id, p_mode, v_rate, actor, now()
  )
  on conflict (technician_id)
  do update set
    mode = excluded.mode,
    hourly_rate_cents = excluded.hourly_rate_cents,
    changed_by = excluded.changed_by,
    changed_at = excluded.changed_at
  returning technician_id, mode, hourly_rate_cents;
end;
$$;

comment on function public.set_technician_compensation(uuid, text, bigint) is
  'Configures a technician''s pay mode (percentage or hourly) and hourly rate. Percentage mode stores a null rate. Admin only.';

-- ---------------------------------------------------------------------------
-- 2. approve_hourly_pay_period_record
--    Approve a pending Friday–Thursday pay period record. Approval is
--    immutable: a missing or already-approved record raises instead of
--    re-approving or unapproving. Office staff only.
-- ---------------------------------------------------------------------------
create or replace function public.approve_hourly_pay_period_record(
  p_technician_id uuid,
  p_period_start date
)
returns table(
  period_start date,
  status text,
  approved_by uuid,
  approved_at timestamptz,
  total_payable_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id uuid;
  v_status text;
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;

  select r.id, r.status
    into v_record_id, v_status
  from public.technician_pay_period_records r
  where r.technician_id = p_technician_id
    and r.period_start = p_period_start
  for update;

  if not found then
    raise exception 'Pay period record not found';
  end if;

  if v_status = 'approved' then
    raise exception 'Pay period already approved';
  end if;

  return query
  update public.technician_pay_period_records r
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  where r.id = v_record_id
  returning r.period_start, r.status, r.approved_by, r.approved_at, r.total_payable_cents;
end;
$$;

comment on function public.approve_hourly_pay_period_record(uuid, date) is
  'Approves a pending Friday–Thursday pay period record. Approval is immutable: missing or already-approved records raise. Office staff only.';

-- ---------------------------------------------------------------------------
-- 3. correct_hourly_shift
--    Correct a settled hourly shift's finished time and recompute payable
--    minutes/cents, recording an audit row. Refuses to touch shifts whose pay
--    period is already approved. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.correct_hourly_shift(
  p_shift_id uuid,
  p_finished_at timestamptz,
  p_reason text default null
)
returns table(
  shift_id uuid,
  finished_at timestamptz,
  payable_minutes integer,
  payable_cents bigint,
  corrected_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_shift_id uuid;
  v_technician_id uuid;
  v_work_date date;
  v_started_at timestamptz;
  v_settlement_due timestamptz;
  v_rate bigint;
  v_old_finished_at timestamptz;
  v_old_payable_minutes integer;
  v_old_payable_cents bigint;
  v_period_start date;
  v_raw_minutes numeric;
  v_payable_minutes integer;
  v_payable_cents bigint;
  v_old_values jsonb;
  v_new_values jsonb;
  v_reason text;
begin
  if not public.is_admin(actor) then
    raise exception 'Admin access required';
  end if;

  select s.id, s.technician_id, s.work_date, s.started_at, s.settlement_due_at,
         s.finished_at, s.payable_minutes, s.payable_cents, s.hourly_rate_cents
    into v_shift_id, v_technician_id, v_work_date, v_started_at, v_settlement_due,
         v_old_finished_at, v_old_payable_minutes, v_old_payable_cents, v_rate
  from public.technician_shifts s
  where s.id = p_shift_id
    and s.compensation_mode = 'hourly'
    and s.settled_at is not null
  for update;

  if not found then
    raise exception 'Shift not eligible for correction';
  end if;

  v_period_start := v_work_date - ((extract(dow from v_work_date)::integer + 2) % 7);

  if exists (
    select 1 from public.technician_pay_period_records r
    where r.technician_id = v_technician_id
      and r.period_start = v_period_start
      and r.status = 'approved'
  ) then
    raise exception 'Pay period already approved';
  end if;

  if p_finished_at is null then
    raise exception 'Finished time required';
  end if;

  if (p_finished_at at time zone 'America/New_York')::date <> v_work_date then
    raise exception 'Finished time outside shift day';
  end if;

  if p_finished_at < v_started_at then
    raise exception 'Finished time before shift start';
  end if;

  if p_finished_at > v_settlement_due then
    raise exception 'Finished time after settlement deadline';
  end if;

  if (p_finished_at - v_started_at) > interval '14 hours' then
    raise exception 'Shift exceeds 14 hours';
  end if;

  v_raw_minutes := floor((extract(epoch from (p_finished_at - v_started_at)) / 60)::numeric);
  v_payable_minutes := (15 * round(v_raw_minutes / 15))::integer;
  v_payable_cents := round((v_payable_minutes::numeric * v_rate) / 60)::bigint;

  v_old_values := jsonb_build_object(
    'finished_at', v_old_finished_at,
    'payable_minutes', v_old_payable_minutes,
    'payable_cents', v_old_payable_cents
  );
  v_new_values := jsonb_build_object(
    'finished_at', p_finished_at,
    'payable_minutes', v_payable_minutes,
    'payable_cents', v_payable_cents
  );
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  insert into public.technician_shift_corrections (
    shift_id, actor_id, old_values, new_values, reason
  ) values (
    v_shift_id, actor, v_old_values, v_new_values, v_reason
  );

  update public.technician_shifts s
  set finished_at = p_finished_at,
      payable_minutes = v_payable_minutes,
      payable_cents = v_payable_cents,
      updated_at = now()
  where s.id = v_shift_id;

  perform public.refresh_hourly_pay_period(v_technician_id, v_work_date);

  return query
  select v_shift_id, p_finished_at, v_payable_minutes, v_payable_cents, now();
end;
$$;

comment on function public.correct_hourly_shift(uuid, timestamptz, text) is
  'Corrects a settled hourly shift''s finished time, recomputes payable minutes/cents on the nearest-15-minute rule, records an audit row, and refreshes the pay period. Refuses shifts whose period is approved. Admin only.';

-- ---------------------------------------------------------------------------
-- 4. Grants
--    Each function enforces its own admin/office guard internally; execute is
--    granted to authenticated.
-- ---------------------------------------------------------------------------
revoke all on function public.set_technician_compensation(uuid, text, bigint) from public;
revoke all on function public.approve_hourly_pay_period_record(uuid, date) from public;
revoke all on function public.correct_hourly_shift(uuid, timestamptz, text) from public;

grant execute on function public.set_technician_compensation(uuid, text, bigint) to authenticated;
grant execute on function public.approve_hourly_pay_period_record(uuid, date) to authenticated;
grant execute on function public.correct_hourly_shift(uuid, timestamptz, text) to authenticated;
