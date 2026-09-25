-- Fuel amount cap ($200) and office fuel edit for technician shifts.
--
-- Part 1 caps the technician-entered fuel amount at $200, both in the
-- `start_technician_shift` RPC (the only authenticated insert path) and as a
-- defense-in-depth table CHECK. Part 2 adds an office-only RPC to correct a
-- shift's fuel after the fact.
--
-- This migration is additive only: it recreates the four-argument
-- `start_technician_shift` overload via `create or replace` (changing ONLY the
-- fuel upper-bound validation), adds one new CHECK constraint and one new RPC,
-- and never drops a column, table, or existing constraint. The return type of
-- `start_technician_shift` is unchanged. Shifts remain optional
-- attendance/fuel records, NOT an authorization boundary.

-- ---------------------------------------------------------------------------
-- A. start_technician_shift — cap fuel at $200
--    Recreate the current 10-column overload, preserving the hourly-snapshot
--    logic EXACTLY, changing only the fuel upper-bound validation from
--    `p_fuel_amount > 9999999999.99` to `p_fuel_amount > 200`.
-- ---------------------------------------------------------------------------
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
    or p_fuel_amount > 200
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
  'Starts a technician shift with a 14-hour active window, caps fuel at $200, snapshots the current primary vehicle, records start-of-shift companions, and attributes hourly shifts to an ET work day with a settlement deadline.';

-- ---------------------------------------------------------------------------
-- B. Defense-in-depth: cap fuel_amount at $200 for every insert/update path.
--    `not valid` skips the existing bad row but bounds all new/updated rows.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_shifts_fuel_max_check'
      and conrelid = 'public.technician_shifts'::regclass
  ) then
    alter table public.technician_shifts
      add constraint technician_shifts_fuel_max_check
      check (fuel_amount <= 200) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- C. set_technician_shift_fuel
--    Office-only correction of a shift's recorded fuel: amount and no-fuel flag.
--    Marking no-fuel zeroes the amount and clears the photo; otherwise the
--    amount must be positive and at most $200.
-- ---------------------------------------------------------------------------
create or replace function public.set_technician_shift_fuel(
  p_shift_id uuid,
  p_fuel_amount numeric,
  p_no_fuel_today boolean
)
returns table(
  shift_id uuid,
  fuel_amount numeric,
  no_fuel_today boolean,
  fuel_photo_path text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift_id uuid;
  v_fuel_amount numeric;
  v_no_fuel_today boolean;
  v_fuel_photo_path text;
  v_updated_at timestamptz;
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;

  if p_shift_id is null then
    raise exception 'Shift required';
  end if;

  if p_no_fuel_today is null or p_fuel_amount is null
    or p_fuel_amount < 0
    or p_fuel_amount > 200
    or p_fuel_amount <> round(p_fuel_amount, 2)
  then
    raise exception 'Invalid fuel information';
  end if;

  if p_no_fuel_today and p_fuel_amount <> 0 then
    raise exception 'Invalid fuel information';
  end if;

  if not p_no_fuel_today and p_fuel_amount <= 0 then
    raise exception 'Invalid fuel information';
  end if;

  select s.id
    into v_shift_id
  from public.technician_shifts s
  where s.id = p_shift_id
  for update;

  if not found then
    raise exception 'Shift unavailable';
  end if;

  update public.technician_shifts s
  set fuel_amount = p_fuel_amount,
      no_fuel_today = p_no_fuel_today,
      fuel_photo_path = case when p_no_fuel_today then null else s.fuel_photo_path end,
      updated_at = now()
  where s.id = v_shift_id
  returning s.id, s.fuel_amount, s.no_fuel_today, s.fuel_photo_path, s.updated_at
  into v_shift_id, v_fuel_amount, v_no_fuel_today, v_fuel_photo_path, v_updated_at;

  return query
  select v_shift_id, v_fuel_amount, v_no_fuel_today, v_fuel_photo_path, v_updated_at;
end;
$$;

comment on function public.set_technician_shift_fuel(uuid, numeric, boolean) is
  'Corrects a shift''s recorded fuel (amount and no-fuel flag) for office staff. Marking no-fuel zeroes the amount and clears the photo; otherwise the amount must be positive and at most $200.';

-- ---------------------------------------------------------------------------
-- D. Grants
--    start_technician_shift stays available to authenticated technicians;
--    set_technician_shift_fuel enforces its own office guard internally.
-- ---------------------------------------------------------------------------
revoke all on function public.start_technician_shift(boolean, numeric, text, uuid[]) from public;
revoke all on function public.set_technician_shift_fuel(uuid, numeric, boolean) from public;

grant execute on function public.start_technician_shift(boolean, numeric, text, uuid[]) to authenticated;
grant execute on function public.set_technician_shift_fuel(uuid, numeric, boolean) to authenticated;
