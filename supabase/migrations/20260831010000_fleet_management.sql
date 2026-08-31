-- Fleet management primitives: vehicles, assignments, operating records,
-- private documents, and least-privilege access for office and field staff.

create extension if not exists btree_gist with schema extensions;

create table public.fleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  unit_number text not null check (btrim(unit_number) <> ''),
  vin text check (
    vin is null
    or upper(btrim(vin)) ~ '^[A-HJ-NPR-Z0-9]{17}$'
  ),
  license_plate text check (license_plate is null or btrim(license_plate) <> ''),
  license_state text check (license_state is null or btrim(license_state) <> ''),
  make text not null check (btrim(make) <> ''),
  model text not null check (btrim(model) <> ''),
  model_year smallint check (model_year is null or model_year between 1900 and 2200),
  color text check (color is null or btrim(color) <> ''),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'maintenance', 'out_of_service', 'retired')
  ),
  acquired_on date,
  retired_on date,
  current_odometer_miles bigint not null default 0 check (current_odometer_miles >= 0),
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fleet_vehicles_retired_on_check check (
    (status = 'retired' and retired_on is not null)
    or (status <> 'retired')
  )
);

create unique index fleet_vehicles_unit_number_unique_idx
  on public.fleet_vehicles (lower(btrim(unit_number)));
create unique index fleet_vehicles_vin_unique_idx
  on public.fleet_vehicles (upper(btrim(vin))) where vin is not null;
create unique index fleet_vehicles_plate_unique_idx
  on public.fleet_vehicles (upper(btrim(license_state)), upper(btrim(license_plate)))
  where license_plate is not null;
create index fleet_vehicles_status_unit_idx
  on public.fleet_vehicles (status, unit_number);

alter table public.technician_shifts
  add column if not exists vehicle_id uuid references public.fleet_vehicles(id) on delete set null;
create index if not exists technician_shifts_vehicle_started_idx
  on public.technician_shifts (vehicle_id, started_at desc)
  where vehicle_id is not null;

create table public.fleet_vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  assignment_role text not null check (assignment_role in ('primary', 'backup')),
  starts_on date not null default current_date,
  ends_on date,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fleet_vehicle_assignments_dates_check
    check (ends_on is null or ends_on >= starts_on),
  constraint fleet_vehicle_assignments_pair_no_overlap exclude using gist (
    vehicle_id with =,
    technician_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  ),
  constraint fleet_vehicle_assignments_vehicle_primary_no_overlap exclude using gist (
    vehicle_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  ) where (assignment_role = 'primary'),
  constraint fleet_vehicle_assignments_technician_primary_no_overlap exclude using gist (
    technician_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  ) where (assignment_role = 'primary')
);

create index fleet_vehicle_assignments_vehicle_dates_idx
  on public.fleet_vehicle_assignments (vehicle_id, starts_on desc, ends_on);
create index fleet_vehicle_assignments_technician_dates_idx
  on public.fleet_vehicle_assignments (technician_id, starts_on desc, ends_on);

create table public.fleet_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  provider text not null check (btrim(provider) <> ''),
  policy_number text not null check (btrim(policy_number) <> ''),
  coverage_type text check (coverage_type is null or btrim(coverage_type) <> ''),
  status text not null default 'active' check (
    status in ('pending', 'active', 'expired', 'cancelled')
  ),
  effective_on date not null,
  expires_on date not null,
  premium_cents bigint check (premium_cents is null or premium_cents >= 0),
  deductible_cents bigint check (deductible_cents is null or deductible_cents >= 0),
  agent_name text,
  agent_phone text,
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fleet_insurance_policies_dates_check check (expires_on >= effective_on),
  unique (provider, policy_number)
);

create index fleet_insurance_policies_vehicle_expiry_idx
  on public.fleet_insurance_policies (vehicle_id, expires_on, status);

create table public.fleet_insurance_payments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.fleet_insurance_policies(id) on delete restrict,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  payment_method text,
  reference_number text,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index fleet_insurance_payments_policy_paid_idx
  on public.fleet_insurance_payments (policy_id, paid_on desc);

create table public.fleet_maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  service_type text not null check (btrim(service_type) <> ''),
  status text not null default 'scheduled' check (
    status in ('scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  scheduled_for date,
  completed_on date,
  odometer_miles bigint check (odometer_miles is null or odometer_miles >= 0),
  vendor text,
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  next_due_on date,
  next_due_odometer_miles bigint check (
    next_due_odometer_miles is null or next_due_odometer_miles >= 0
  ),
  description text,
  notes text check (notes is null or char_length(notes) <= 5000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fleet_maintenance_completion_check check (
    status <> 'completed' or completed_on is not null
  ),
  constraint fleet_maintenance_next_odometer_check check (
    next_due_odometer_miles is null
    or odometer_miles is null
    or next_due_odometer_miles >= odometer_miles
  )
);

create index fleet_maintenance_vehicle_completed_idx
  on public.fleet_maintenance_records (vehicle_id, completed_on desc);
create index fleet_maintenance_due_date_idx
  on public.fleet_maintenance_records (next_due_on)
  where next_due_on is not null and status = 'completed';
create index fleet_maintenance_due_odometer_idx
  on public.fleet_maintenance_records (vehicle_id, next_due_odometer_miles)
  where next_due_odometer_miles is not null and status = 'completed';

create table public.fleet_odometer_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  reading_miles bigint not null check (reading_miles >= 0),
  recorded_on date not null default current_date,
  source text not null default 'manual' check (
    source in ('weekly', 'maintenance', 'shift', 'manual')
  ),
  shift_id uuid references public.technician_shifts(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 2000),
  submitted_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fleet_odometer_shift_vehicle_check check (
    (source = 'shift' and shift_id is not null)
    or (source <> 'shift' and shift_id is null)
  )
);

create index fleet_odometer_vehicle_recorded_idx
  on public.fleet_odometer_readings (vehicle_id, recorded_on desc, created_at desc);
create index fleet_odometer_submitter_recorded_idx
  on public.fleet_odometer_readings (submitted_by, recorded_on desc);
create unique index fleet_odometer_weekly_submission_unique_idx
  on public.fleet_odometer_readings (vehicle_id, recorded_on, submitted_by)
  where source = 'weekly';

create table public.fleet_expenses (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  expense_type text not null check (
    expense_type in ('registration', 'toll', 'parking', 'wash', 'repair', 'other')
  ),
  occurred_on date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  vendor text,
  description text not null check (btrim(description) <> ''),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index fleet_expenses_vehicle_occurred_idx
  on public.fleet_expenses (vehicle_id, occurred_on desc);

create table public.fleet_incidents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  reported_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  severity text not null default 'medium' check (
    severity in ('low', 'medium', 'high', 'critical')
  ),
  status text not null default 'open' check (
    status in ('open', 'investigating', 'resolved', 'closed')
  ),
  title text not null check (btrim(title) <> ''),
  description text not null check (btrim(description) <> ''),
  location text,
  odometer_miles bigint check (odometer_miles is null or odometer_miles >= 0),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution_notes text check (resolution_notes is null or char_length(resolution_notes) <= 5000),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fleet_incidents_resolution_check check (
    (status in ('resolved', 'closed') and resolved_at is not null and resolved_by is not null)
    or (
      status in ('open', 'investigating')
      and resolved_at is null
      and resolved_by is null
    )
  )
);

create index fleet_incidents_vehicle_status_idx
  on public.fleet_incidents (vehicle_id, status, occurred_at desc);
create index fleet_incidents_reporter_idx
  on public.fleet_incidents (reported_by, occurred_at desc);

create table public.fleet_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.fleet_vehicles(id) on delete restrict,
  document_type text not null check (
    document_type in (
      'registration', 'insurance', 'inspection', 'maintenance',
      'incident', 'receipt', 'title', 'other'
    )
  ),
  title text not null check (btrim(title) <> ''),
  bucket_id text not null default 'fleet-documents' check (bucket_id = 'fleet-documents'),
  storage_path text not null unique,
  mime_type text not null check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  expires_on date,
  notes text check (notes is null or char_length(notes) <= 2000),
  uploaded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint fleet_documents_path_check check (
    storage_path ~ (
      '^' || vehicle_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](pdf|jpg|jpeg|png|webp)$'
    )
  )
);

create index fleet_documents_vehicle_type_idx
  on public.fleet_documents (vehicle_id, document_type, created_at desc);
create index fleet_documents_expiry_idx
  on public.fleet_documents (expires_on) where expires_on is not null;

create table public.fleet_settings (
  id smallint primary key default 1 check (id = 1),
  weekly_odometer_day smallint not null default 1 check (weekly_odometer_day between 0 and 6),
  weekly_odometer_required boolean not null default false,
  alert_day_offsets smallint[] not null default array[30, 14, 7, 0]::smallint[] check (
    cardinality(alert_day_offsets) between 1 and 10
  ),
  timezone text not null default 'America/New_York' check (btrim(timezone) <> ''),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- Keep audit ownership immutable and make every update attributable to the actor.
create or replace function public.fleet_apply_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(auth.uid(), new.updated_by, new.created_by);
    new.created_at := coalesce(new.created_at, clock_timestamp());
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.fleet_apply_audit_fields() from public;

create or replace function public.fleet_validate_assignment_technician()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_technician(new.technician_id) then
    raise exception 'Fleet assignments require an active technician';
  end if;
  return new;
end;
$$;

revoke all on function public.fleet_validate_assignment_technician() from public;

create trigger fleet_vehicles_apply_audit
before insert or update on public.fleet_vehicles
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_vehicle_assignments_apply_audit
before insert or update on public.fleet_vehicle_assignments
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_vehicle_assignments_validate_technician
before insert or update of technician_id on public.fleet_vehicle_assignments
for each row execute function public.fleet_validate_assignment_technician();
create trigger fleet_insurance_policies_apply_audit
before insert or update on public.fleet_insurance_policies
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_insurance_payments_apply_audit
before insert or update on public.fleet_insurance_payments
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_maintenance_records_apply_audit
before insert or update on public.fleet_maintenance_records
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_odometer_readings_apply_audit
before insert or update on public.fleet_odometer_readings
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_expenses_apply_audit
before insert or update on public.fleet_expenses
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_incidents_apply_audit
before insert or update on public.fleet_incidents
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_documents_apply_audit
before insert or update on public.fleet_documents
for each row execute function public.fleet_apply_audit_fields();
create trigger fleet_settings_apply_audit
before insert or update on public.fleet_settings
for each row execute function public.fleet_apply_audit_fields();

-- Active vehicles must finish each transaction with exactly one current primary
-- assignment. Draft vehicles allow the office to create the master record first.
create or replace function public.fleet_require_active_vehicle_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vehicle_ids uuid[];
  checked_vehicle_id uuid;
  primary_count integer;
begin
  if tg_table_name = 'fleet_vehicles' then
    if tg_op = 'INSERT' then
      vehicle_ids := array[new.id];
    else
      vehicle_ids := array[old.id, new.id];
    end if;
  elsif tg_op = 'INSERT' then
    vehicle_ids := array[new.vehicle_id];
  elsif tg_op = 'DELETE' then
    vehicle_ids := array[old.vehicle_id];
  else
    vehicle_ids := array[old.vehicle_id, new.vehicle_id];
  end if;

  foreach checked_vehicle_id in array vehicle_ids loop
    continue when checked_vehicle_id is null;
    if exists (
      select 1 from public.fleet_vehicles v
      where v.id = checked_vehicle_id and v.status = 'active'
    ) then
      select count(*)::integer into primary_count
      from public.fleet_vehicle_assignments a
      where a.vehicle_id = checked_vehicle_id
        and a.assignment_role = 'primary'
        and a.starts_on <= current_date
        and (a.ends_on is null or a.ends_on >= current_date);
      if primary_count <> 1 then
        raise exception 'Active fleet vehicle requires exactly one current primary driver';
      end if;
    end if;
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.fleet_require_active_vehicle_primary() from public;

create constraint trigger fleet_vehicles_require_primary
after insert or update on public.fleet_vehicles
deferrable initially deferred
for each row execute function public.fleet_require_active_vehicle_primary();
create constraint trigger fleet_assignments_require_primary
after insert or update or delete on public.fleet_vehicle_assignments
deferrable initially deferred
for each row execute function public.fleet_require_active_vehicle_primary();

create or replace function public.can_access_fleet_vehicle(
  check_vehicle_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_vehicle_id is not null
    and check_user_id is not null
    and (
      public.is_office_staff(check_user_id)
      or exists (
        select 1
        from public.fleet_vehicle_assignments a
        where a.vehicle_id = check_vehicle_id
          and a.technician_id = check_user_id
          and a.starts_on <= current_date
          and (a.ends_on is null or a.ends_on >= current_date)
      )
    );
$$;

revoke all on function public.can_access_fleet_vehicle(uuid, uuid) from public;
grant execute on function public.can_access_fleet_vehicle(uuid, uuid) to authenticated;

create or replace function public.fleet_vehicle_id_from_storage_path(object_name text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  prefix text := split_part(coalesce(object_name, ''), '/', 1);
begin
  if prefix ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return prefix::uuid;
  end if;
  return null;
end;
$$;

revoke all on function public.fleet_vehicle_id_from_storage_path(text) from public;
grant execute on function public.fleet_vehicle_id_from_storage_path(text) to authenticated;

create or replace function public.fleet_advance_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fleet_vehicles
  set current_odometer_miles = greatest(current_odometer_miles, new.reading_miles),
      updated_by = new.submitted_by,
      updated_at = clock_timestamp()
  where id = new.vehicle_id and current_odometer_miles < new.reading_miles;
  return new;
end;
$$;

revoke all on function public.fleet_advance_vehicle_odometer() from public;

create trigger fleet_odometer_advance_vehicle
after insert on public.fleet_odometer_readings
for each row execute function public.fleet_advance_vehicle_odometer();

-- A single office ledger reuses shift fuel rather than creating a second fuel
-- table. Security-invoker keeps every source table's RLS authoritative.
create view public.fleet_cost_ledger
with (security_invoker = true)
as
select
  'insurance'::text as source_type,
  payment.id as source_id,
  policy.vehicle_id,
  payment.paid_on as occurred_on,
  payment.amount_cents,
  ('Insurance payment: ' || policy.provider || ' / ' || policy.policy_number)::text as description
from public.fleet_insurance_payments payment
join public.fleet_insurance_policies policy on policy.id = payment.policy_id
union all
select
  'maintenance'::text,
  maintenance.id,
  maintenance.vehicle_id,
  maintenance.completed_on,
  maintenance.cost_cents,
  ('Maintenance: ' || maintenance.service_type)::text
from public.fleet_maintenance_records maintenance
where maintenance.status = 'completed'
  and maintenance.completed_on is not null
  and maintenance.cost_cents > 0
union all
select
  'expense'::text,
  expense.id,
  expense.vehicle_id,
  expense.occurred_on,
  expense.amount_cents,
  expense.description
from public.fleet_expenses expense
union all
select
  'fuel'::text,
  shift.id,
  shift.vehicle_id,
  (shift.started_at at time zone 'America/New_York')::date,
  round(shift.fuel_amount * 100)::bigint,
  'Shift fuel'::text
from public.technician_shifts shift
where shift.vehicle_id is not null
  and not shift.no_fuel_today
  and shift.fuel_amount > 0;

revoke all on public.fleet_cost_ledger from public;
revoke all on public.fleet_cost_ledger from anon;
revoke all on public.fleet_cost_ledger from authenticated;

create or replace function public.list_fleet_cost_ledger(
  p_start_on date default null,
  p_end_on date default null,
  p_vehicle_id uuid default null
)
returns table (
  source_type text,
  source_id uuid,
  vehicle_id uuid,
  occurred_on date,
  amount_cents bigint,
  description text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Office access required';
  end if;
  if p_start_on is not null and p_end_on is not null
    and (p_end_on < p_start_on or p_end_on - p_start_on > 366)
  then
    raise exception 'Invalid fleet ledger date range';
  end if;

  return query
  select ledger.source_type, ledger.source_id, ledger.vehicle_id,
    ledger.occurred_on, ledger.amount_cents, ledger.description
  from public.fleet_cost_ledger ledger
  where (p_start_on is null or ledger.occurred_on >= p_start_on)
    and (p_end_on is null or ledger.occurred_on <= p_end_on)
    and (p_vehicle_id is null or ledger.vehicle_id = p_vehicle_id)
  order by ledger.occurred_on desc, ledger.source_type, ledger.source_id;
end;
$$;

revoke all on function public.list_fleet_cost_ledger(date, date, uuid) from public;
grant execute on function public.list_fleet_cost_ledger(date, date, uuid) to authenticated;

alter table public.notifications
  add column if not exists source_key text;
create unique index if not exists notifications_user_source_key_unique_idx
  on public.notifications (user_id, source_key)
  where source_key is not null;

create or replace function public.notifications_preserve_source_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_key is distinct from old.source_key then
    raise exception 'Notification source key is immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.notifications_preserve_source_key() from public;

create trigger notifications_preserve_source_key_before_update
before update on public.notifications
for each row execute function public.notifications_preserve_source_key();

alter table public.fleet_vehicles enable row level security;
alter table public.fleet_vehicle_assignments enable row level security;
alter table public.fleet_insurance_policies enable row level security;
alter table public.fleet_insurance_payments enable row level security;
alter table public.fleet_maintenance_records enable row level security;
alter table public.fleet_odometer_readings enable row level security;
alter table public.fleet_expenses enable row level security;
alter table public.fleet_incidents enable row level security;
alter table public.fleet_documents enable row level security;
alter table public.fleet_settings enable row level security;

create policy "Office staff manage fleet_vehicles"
on public.fleet_vehicles for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_vehicle_assignments"
on public.fleet_vehicle_assignments for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_insurance_policies"
on public.fleet_insurance_policies for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_insurance_payments"
on public.fleet_insurance_payments for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_maintenance_records"
on public.fleet_maintenance_records for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_odometer_readings"
on public.fleet_odometer_readings for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_expenses"
on public.fleet_expenses for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_incidents"
on public.fleet_incidents for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_documents"
on public.fleet_documents for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff manage fleet_settings"
on public.fleet_settings for all to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());

create policy "Technicians view assigned fleet vehicles"
on public.fleet_vehicles for select to authenticated
using (
  public.is_technician()
  and public.can_access_fleet_vehicle(id, auth.uid())
);
create policy "Technicians view assigned fleet assignments"
on public.fleet_vehicle_assignments for select to authenticated
using (
  public.is_technician()
  and technician_id = auth.uid()
  and starts_on <= current_date
  and (ends_on is null or ends_on >= current_date)
);
create policy "Technicians view assigned fleet insurance"
on public.fleet_insurance_policies for select to authenticated
using (public.is_technician() and public.can_access_fleet_vehicle(vehicle_id, auth.uid()));
create policy "Technicians view assigned fleet maintenance"
on public.fleet_maintenance_records for select to authenticated
using (public.is_technician() and public.can_access_fleet_vehicle(vehicle_id, auth.uid()));
create policy "Technicians view assigned fleet odometer"
on public.fleet_odometer_readings for select to authenticated
using (public.is_technician() and public.can_access_fleet_vehicle(vehicle_id, auth.uid()));
create policy "Technicians report assigned fleet odometer"
on public.fleet_odometer_readings for insert to authenticated
with check (
  public.is_operational_worker()
  and public.can_access_fleet_vehicle(vehicle_id, auth.uid())
  and submitted_by = auth.uid()
  and created_by = auth.uid()
  and updated_by = auth.uid()
);
create policy "Technicians view assigned fleet incidents"
on public.fleet_incidents for select to authenticated
using (public.is_technician() and public.can_access_fleet_vehicle(vehicle_id, auth.uid()));
create policy "Technicians report assigned fleet incidents"
on public.fleet_incidents for insert to authenticated
with check (
  public.is_operational_worker()
  and public.can_access_fleet_vehicle(vehicle_id, auth.uid())
  and reported_by = auth.uid()
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and status = 'open'
  and resolved_at is null
  and resolved_by is null
);
create policy "Technicians view assigned fleet documents"
on public.fleet_documents for select to authenticated
using (public.is_technician() and public.can_access_fleet_vehicle(vehicle_id, auth.uid()));
create policy "Technicians view fleet settings"
on public.fleet_settings for select to authenticated
using (public.is_technician());

grant select, insert, update, delete on public.fleet_vehicles to authenticated;
grant select, insert, update, delete on public.fleet_vehicle_assignments to authenticated;
grant select, insert, update, delete on public.fleet_insurance_policies to authenticated;
grant select, insert, update, delete on public.fleet_insurance_payments to authenticated;
grant select, insert, update, delete on public.fleet_maintenance_records to authenticated;
grant select, insert, update, delete on public.fleet_odometer_readings to authenticated;
grant select, insert, update, delete on public.fleet_expenses to authenticated;
grant select, insert, update, delete on public.fleet_incidents to authenticated;
grant select, insert, update, delete on public.fleet_documents to authenticated;
grant select, insert, update, delete on public.fleet_settings to authenticated;

insert into storage.buckets (id, name, public)
values ('fleet-documents', 'fleet-documents', false)
on conflict (id) do update set public = false;

create policy "Office staff manage fleet document objects"
on storage.objects for all to authenticated
using (bucket_id = 'fleet-documents' and public.is_office_staff())
with check (bucket_id = 'fleet-documents' and public.is_office_staff());

create policy "Technicians read assigned fleet document objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'fleet-documents'
  and public.is_technician()
  and public.can_access_fleet_vehicle(
    public.fleet_vehicle_id_from_storage_path(name),
    auth.uid()
  )
  and exists (
    select 1 from public.fleet_documents d
    where d.vehicle_id = public.fleet_vehicle_id_from_storage_path(name)
      and d.bucket_id = bucket_id
      and d.storage_path = name
  )
);
