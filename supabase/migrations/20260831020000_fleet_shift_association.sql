-- Bind each new technician shift to the technician's active primary vehicle in
-- the same database transaction. A missing primary assignment remains valid.
create or replace function public.start_technician_shift(
  p_no_fuel_today boolean,
  p_fuel_amount numeric,
  p_fuel_photo_path text default null
)
returns table(
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  fuel_amount numeric,
  no_fuel_today boolean,
  fuel_photo_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  begins_at timestamptz := now();
  ends_at timestamptz := now() + interval '10 hours';
  clean_photo_path text := nullif(btrim(p_fuel_photo_path), '');
  new_shift_id uuid;
  primary_vehicle_id uuid;
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
    no_fuel_today, fuel_photo_path, created_by
  ) values (
    actor, primary_vehicle_id, begins_at, ends_at, p_fuel_amount,
    p_no_fuel_today, clean_photo_path, actor
  ) returning id into new_shift_id;

  return query
  select s.id, s.started_at, s.active_until, s.fuel_amount,
    s.no_fuel_today, s.fuel_photo_path
  from public.technician_shifts s where s.id = new_shift_id;
end;
$$;

comment on function public.start_technician_shift(boolean, numeric, text) is
  'Starts a technician shift and atomically snapshots the current primary vehicle, if assigned.';

-- Existing callers keep get_my_active_shift(); fleet-aware callers use this
-- compatible companion RPC to obtain the captured vehicle association.
create or replace function public.get_my_active_shift_with_vehicle()
returns table(
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  fuel_amount numeric,
  no_fuel_today boolean,
  fuel_photo_path text,
  server_now timestamptz,
  vehicle_id uuid,
  vehicle_unit_number text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_technician(auth.uid()) then
    raise exception 'Active technician required';
  end if;
  return query
  select s.id, s.started_at, s.active_until, s.fuel_amount,
    s.no_fuel_today, s.fuel_photo_path, now(), s.vehicle_id, v.unit_number
  from public.technician_shifts s
  left join public.fleet_vehicles v on v.id = s.vehicle_id
  where s.technician_id = auth.uid()
    and s.started_at <= now()
    and s.active_until > now()
  order by s.started_at desc
  limit 1;
end;
$$;

create or replace function public.set_technician_shift_vehicle(
  p_shift_id uuid,
  p_vehicle_id uuid
)
returns table(
  shift_id uuid,
  previous_vehicle_id uuid,
  vehicle_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_vehicle_id uuid;
  updated_shift_id uuid;
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;
  if p_shift_id is null then
    raise exception 'Shift required';
  end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.fleet_vehicles v where v.id = p_vehicle_id
  ) then
    raise exception 'Vehicle unavailable';
  end if;

  select s.vehicle_id into old_vehicle_id
  from public.technician_shifts s
  where s.id = p_shift_id
  for update;
  if not found then
    raise exception 'Shift unavailable';
  end if;

  update public.technician_shifts s
  set vehicle_id = p_vehicle_id,
      updated_at = clock_timestamp()
  where s.id = p_shift_id
  returning s.id into updated_shift_id;

  return query select updated_shift_id, old_vehicle_id, p_vehicle_id;
end;
$$;

revoke all on function public.start_technician_shift(boolean, numeric, text) from public;
revoke all on function public.get_my_active_shift_with_vehicle() from public;
revoke all on function public.set_technician_shift_vehicle(uuid, uuid) from public;
grant execute on function public.start_technician_shift(boolean, numeric, text) to authenticated;
grant execute on function public.get_my_active_shift_with_vehicle() to authenticated;
grant execute on function public.set_technician_shift_vehicle(uuid, uuid) to authenticated;
