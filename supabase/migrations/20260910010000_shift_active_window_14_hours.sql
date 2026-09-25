-- Widen the fixed operational active window for all technician shifts from
-- 10 hours to 14 hours. The previous exact-duration constraint pinned
-- `active_until = started_at + interval '10 hours'`; historical rows already
-- carry that 10-hour window, so re-pinning to 14 hours would reject them and
-- would also block future hourly close/settlement semantics. The window is
-- instead enforced by `start_technician_shift`, which is the only insert path
-- (the table grants no direct authenticated writes).

alter table public.technician_shifts
  drop constraint if exists technician_shifts_exact_duration_check;

alter table public.technician_shifts
  add constraint technician_shifts_duration_check
  check (active_until > started_at);

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
  fuel_photo_path text
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
    s.no_fuel_today, s.fuel_photo_path
  from public.technician_shifts s where s.id = new_shift_id;
end;
$$;

comment on function public.start_technician_shift(boolean, numeric, text, uuid[]) is
  'Starts a technician shift with a 14-hour active window, snapshots the current primary vehicle, and records start-of-shift companions.';

revoke all on function public.start_technician_shift(boolean, numeric, text, uuid[]) from public;
grant execute on function public.start_technician_shift(boolean, numeric, text, uuid[]) to authenticated;
