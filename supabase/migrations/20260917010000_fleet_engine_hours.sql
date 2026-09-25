-- Engine-hour readings are immutable operational evidence for fleet maintenance.

alter table public.fleet_vehicles
  add column if not exists current_engine_hours bigint not null default 0
  check (current_engine_hours >= 0);

create table public.fleet_engine_hour_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  reading_hours bigint not null check (reading_hours >= 0),
  recorded_on date not null default current_date,
  source text not null check (source in ('manual', 'technician')),
  notes text check (notes is null or char_length(notes) <= 2000),
  submitted_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index fleet_engine_hours_vehicle_recorded_idx
  on public.fleet_engine_hour_readings (vehicle_id, recorded_on desc, created_at desc);
create index fleet_engine_hours_submitter_recorded_idx
  on public.fleet_engine_hour_readings (submitted_by, recorded_on desc);

create or replace function public.fleet_validate_engine_hour_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_hours bigint;
begin
  if tg_op = 'UPDATE' and new.vehicle_id <> old.vehicle_id then
    raise exception 'Engine-hour readings cannot move between vehicles';
  end if;

  select vehicle.current_engine_hours
  into current_hours
  from public.fleet_vehicles vehicle
  where vehicle.id = new.vehicle_id
  for update;

  if not found then
    raise exception 'Fleet vehicle does not exist';
  end if;

  if new.reading_hours < current_hours then
    raise exception 'Engine hours cannot decrease';
  end if;

  return new;
end;
$$;

revoke all on function public.fleet_validate_engine_hour_reading() from public;

create trigger fleet_engine_hours_validate_reading
before insert or update on public.fleet_engine_hour_readings
for each row execute function public.fleet_validate_engine_hour_reading();

create trigger fleet_engine_hours_apply_audit
before insert or update on public.fleet_engine_hour_readings
for each row execute function public.fleet_apply_audit_fields();

create or replace function public.fleet_advance_vehicle_engine_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fleet_vehicles
  set current_engine_hours = greatest(current_engine_hours, new.reading_hours),
      updated_by = new.submitted_by,
      updated_at = clock_timestamp()
  where id = new.vehicle_id and current_engine_hours < new.reading_hours;
  return new;
end;
$$;

revoke all on function public.fleet_advance_vehicle_engine_hours() from public;

create trigger fleet_engine_hours_advance_vehicle
after insert on public.fleet_engine_hour_readings
for each row execute function public.fleet_advance_vehicle_engine_hours();

alter table public.fleet_engine_hour_readings enable row level security;

create policy "Office staff view fleet engine hours"
on public.fleet_engine_hour_readings for select to authenticated
using (public.is_office_staff());

create policy "Office staff report fleet engine hours"
on public.fleet_engine_hour_readings for insert to authenticated
with check (
  public.is_office_staff()
  and submitted_by = auth.uid()
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

create policy "Technicians view assigned fleet engine hours"
on public.fleet_engine_hour_readings for select to authenticated
using (public.is_technician() and public.can_access_fleet_vehicle(vehicle_id, auth.uid()));

create policy "Technicians report assigned fleet engine hours"
on public.fleet_engine_hour_readings for insert to authenticated
with check (
  public.is_technician()
  and public.can_access_fleet_vehicle(vehicle_id, auth.uid())
  and submitted_by = auth.uid()
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and source = 'technician'
);

grant select, insert on public.fleet_engine_hour_readings to authenticated;
