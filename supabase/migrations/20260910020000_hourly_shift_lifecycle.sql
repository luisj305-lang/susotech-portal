-- Hourly technician shift lifecycle (Work Unit 2 of the hourly payroll plan):
-- hourly-mode start enrichment, self-close settlement, and pay-period refresh.
--
-- This migration is additive only: it recreates the four-argument
-- `start_technician_shift` overload via `create or replace`, adds two new
-- functions, and never drops a column, table, or existing constraint. The
-- existing `technician_shifts_duration_check` and `technician_shifts_no_overlap`
-- constraints are left untouched.
--
-- Shifts remain optional attendance/fuel records, NOT an authorization
-- boundary: hourly mode does not change `is_technician`, RLS job access, or
-- technician navigation.

-- ---------------------------------------------------------------------------
-- A. start_technician_shift (recreate the 4-arg overload)
--    Resolves the actor's compensation settings and, for hourly technicians,
--    attributes the shift to an America/New_York work day with a settlement
--    deadline. Percentage technicians keep `work_date`/`settlement_due_at` null.
-- ---------------------------------------------------------------------------
drop function if exists public.start_technician_shift(boolean, numeric, text, uuid[]);

create or replace function public.start_technician_shift(
  p_no_fuel_today boolean,
  p_fuel_amount numeric,
  p_fuel_photo_path text default null,
  p_companion_ids uuid[] default null
)
returns table(
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  fuel_amount numeric,
  no_fuel_today boolean,
  fuel_photo_path text,
  work_date date,
  settlement_due_at timestamptz,
  compensation_mode text,
  hourly_rate_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  begins_at timestamptz := now();
  ends_at timestamptz := now() + interval '14 hours';
  clean_photo_path text := nullif(btrim(p_fuel_photo_path), '');
  new_shift_id uuid;
  primary_vehicle_id uuid;
  v_mode text := 'percentage';
  v_rate bigint := null;
  v_work_date date := (now() at time zone 'America/New_York')::date;
  v_settlement_due timestamptz := ((v_work_date + 1)::timestamp at time zone 'America/New_York');
begin
  if not public.is_technician(actor) then
    raise exception 'Active technician required';
  end if;
  if p_no_fuel_today is null or p_fuel_amount is null
    or p_fuel_amount < 0
    or p_fuel_amount > 9999999999.99
    or p_fuel_amount <> round(p_fuel_amount, 2)
    or (p_no_fuel_today and (p_fuel_amount <> 0 or clean_photo_path is not null))
    or (not p_no_fuel_today and p_fuel_amount <= 0)
  then
    raise exception 'Invalid fuel information';
  end if;

  select cs.mode, cs.hourly_rate_cents
    into v_mode, v_rate
  from public.technician_compensation_settings cs
  where cs.technician_id = actor;

  if not found then
    v_mode := 'percentage';
    v_rate := null;
  end if;

  if v_mode = 'hourly' and coalesce(v_rate, 0) <= 0 then
    raise exception 'Hourly rate not configured';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('technician-shift:' || actor::text, 0)
  );

  if exists (
    select 1 from public.technician_shifts s
    where s.technician_id = actor
      and s.started_at <= begins_at
      and s.active_until > begins_at
  ) then
    raise exception 'An active shift already exists';
  end if;

  if v_mode = 'hourly' and exists (
    select 1 from public.technician_shifts s
    where s.technician_id = actor
      and s.work_date = v_work_date
  ) then
    raise exception 'A shift is already recorded for today';
  end if;

  if clean_photo_path is not null then
    if clean_photo_path !~ (
      '^' || actor::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
    ) or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'technician-shift-fuel'
        and o.name = clean_photo_path
        and lower(coalesce(o.metadata ->> 'mimetype', '')) in (
          'image/jpeg', 'image/png', 'image/webp'
        )
        and coalesce((o.metadata ->> 'size')::bigint, 0) between 1 and 10485760
    ) then
      raise exception 'Invalid fuel photo';
    end if;
  end if;

  select a.vehicle_id
  into primary_vehicle_id
  from public.fleet_vehicle_assignments a
  where a.technician_id = actor
    and a.assignment_role = 'primary'
    and a.starts_on <= current_date
    and (a.ends_on is null or a.ends_on >= current_date)
  order by a.starts_on desc, a.created_at desc
  limit 1;

  insert into public.technician_shifts (
    technician_id, vehicle_id, started_at, active_until, fuel_amount,
    no_fuel_today, fuel_photo_path, created_by,
    compensation_mode, hourly_rate_cents, work_date, settlement_due_at
  ) values (
    actor, primary_vehicle_id, begins_at, ends_at, p_fuel_amount,
    p_no_fuel_today, clean_photo_path, actor,
    v_mode,
    case when v_mode = 'hourly' then v_rate else null end,
    case when v_mode = 'hourly' then v_work_date else null end,
    case when v_mode = 'hourly' then v_settlement_due else null end
  ) returning id into new_shift_id;

  if p_companion_ids is not null then
    if cardinality(p_companion_ids) > 20 then
      raise exception 'Too many companions';
    end if;

    if exists (
      select 1
      from unnest(p_companion_ids) as c(id)
      where c.id is null
         or not exists (
           select 1 from public.profiles p
           where p.id = c.id and p.role = 'tecnico' and p.is_active
         )
    ) then
      raise exception 'Invalid companion';
    end if;

    insert into public.technician_shift_companions (shift_id, technician_id, recorded_by)
    select new_shift_id, c.id, actor
    from (select distinct unnest(p_companion_ids) as id) c
    where c.id <> actor;
  end if;

  return query
  select s.id, s.started_at, s.active_until, s.fuel_amount,
    s.no_fuel_today, s.fuel_photo_path,
    s.work_date, s.settlement_due_at, s.compensation_mode, s.hourly_rate_cents
  from public.technician_shifts s where s.id = new_shift_id;
end;
$$;

comment on function public.start_technician_shift(boolean, numeric, text, uuid[]) is
  'Starts a technician shift with a 14-hour active window, snapshots the current primary vehicle, records start-of-shift companions, and attributes hourly shifts to an ET work day with a settlement deadline.';

-- ---------------------------------------------------------------------------
-- B. close_my_hourly_shift
--    Self-close the technician's open hourly shift: validate the finished time,
--    round payable minutes to the nearest 15-minute increment, settle payable
--    cents at the hourly rate, and refresh the pay period.
-- ---------------------------------------------------------------------------
create or replace function public.close_my_hourly_shift(
  p_finished_at timestamptz
)
returns table(
  shift_id uuid,
  finished_at timestamptz,
  payable_minutes integer,
  payable_cents bigint,
  settled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_shift_id uuid;
  v_started_at timestamptz;
  v_work_date date;
  v_settlement_due timestamptz;
  v_rate bigint;
  v_raw_minutes numeric;
  v_payable_minutes integer;
  v_payable_cents bigint;
  v_settled_at timestamptz;
begin
  if not public.is_technician(actor) then
    raise exception 'Active technician required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('technician-shift:' || actor::text, 0)
  );

  select s.id, s.started_at, s.work_date, s.settlement_due_at, s.hourly_rate_cents
    into v_shift_id, v_started_at, v_work_date, v_settlement_due, v_rate
  from public.technician_shifts s
  where s.technician_id = actor
    and s.compensation_mode = 'hourly'
    and s.settled_at is null
    and s.settlement_due_at > now()
    and s.work_date = (now() at time zone 'America/New_York')::date
  order by s.started_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No open hourly shift';
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

  v_settled_at := now();

  update public.technician_shifts s
  set finished_at = p_finished_at,
      settled_at = v_settled_at,
      settlement_kind = 'self',
      payable_minutes = v_payable_minutes,
      payable_cents = v_payable_cents,
      updated_at = v_settled_at
  where s.id = v_shift_id;

  perform public.refresh_hourly_pay_period(actor, v_work_date);

  return query
  select v_shift_id, p_finished_at, v_payable_minutes, v_payable_cents, v_settled_at;
end;
$$;

comment on function public.close_my_hourly_shift(timestamptz) is
  'Closes the technician''s open hourly shift, settles payable minutes/cents rounded to 15-minute increments, and refreshes the Friday–Thursday pay period.';

-- ---------------------------------------------------------------------------
-- C. refresh_hourly_pay_period (internal helper)
--    Recompute the Friday–Thursday pay period total from settled hourly shifts.
--    Internal only: not granted to authenticated. Approved periods are
--    immutable and never modified.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_hourly_pay_period(
  p_technician_id uuid,
  p_work_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_start date := p_work_date - ((extract(dow from p_work_date)::integer + 2) % 7);
  v_period_end_exclusive date := v_period_start + 7;
  v_total bigint;
begin
  select coalesce(sum(s.payable_cents), 0)::bigint
    into v_total
  from public.technician_shifts s
  where s.technician_id = p_technician_id
    and s.compensation_mode = 'hourly'
    and s.settled_at is not null
    and s.work_date >= v_period_start
    and s.work_date < v_period_end_exclusive;

  insert into public.technician_pay_period_records (
    technician_id, period_start, period_end_exclusive, status, total_payable_cents
  ) values (
    p_technician_id, v_period_start, v_period_end_exclusive, 'pending', v_total
  )
  on conflict (technician_id, period_start)
  do update set
    period_end_exclusive = excluded.period_end_exclusive,
    total_payable_cents = excluded.total_payable_cents,
    updated_at = now()
  where public.technician_pay_period_records.status = 'pending';
end;
$$;

comment on function public.refresh_hourly_pay_period(uuid, date) is
  'Recomputes a technician''s pending Friday–Thursday pay period from settled hourly shifts. Internal only: approved periods are immutable.';

-- ---------------------------------------------------------------------------
-- D. Grants
--    start_technician_shift stays available to authenticated technicians;
--    close_my_hourly_shift is authenticated-only; refresh_hourly_pay_period is
--    internal and revoked from both public and authenticated.
-- ---------------------------------------------------------------------------
revoke all on function public.start_technician_shift(boolean, numeric, text, uuid[]) from public;
revoke all on function public.close_my_hourly_shift(timestamptz) from public;
revoke all on function public.refresh_hourly_pay_period(uuid, date) from public;
revoke all on function public.refresh_hourly_pay_period(uuid, date) from authenticated;

grant execute on function public.start_technician_shift(boolean, numeric, text, uuid[]) to authenticated;
grant execute on function public.close_my_hourly_shift(timestamptz) to authenticated;
