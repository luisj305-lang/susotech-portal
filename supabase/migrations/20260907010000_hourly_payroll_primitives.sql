-- Hourly technician payroll primitives (schema only).
--
-- This migration adds the tables, columns, indexes, constraints, and read-only
-- RLS policies needed for hourly technician payroll. Mutations (setting
-- compensation, settling shifts, approving periods, recording corrections) are
-- intentionally NOT introduced here; they arrive as security-definer RPCs in
-- later work units. Nothing in this file modifies or drops existing schema, and
-- it does not restore any shift-gated job access (shifts remain optional
-- attendance/fuel records, not an authorization boundary).

-- ---------------------------------------------------------------------------
-- 1. technician_compensation_settings
--    Current per-technician pay configuration, owned by office staff.
--    `mode` is 'percentage' (default) or 'hourly'. Hourly mode requires a
--    positive `hourly_rate_cents`; percentage mode requires null/zero.
-- ---------------------------------------------------------------------------
create table if not exists public.technician_compensation_settings (
  technician_id uuid primary key references public.profiles(id) on delete restrict,
  mode text not null default 'percentage'
    constraint technician_compensation_settings_mode_check
    check (mode in ('percentage', 'hourly')),
  hourly_rate_cents bigint,
  changed_by uuid references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint technician_compensation_settings_rate_check check (
    (mode = 'hourly' and hourly_rate_cents is not null and hourly_rate_cents > 0)
    or (mode = 'percentage' and (hourly_rate_cents is null or hourly_rate_cents = 0))
  )
);

alter table public.technician_compensation_settings enable row level security;

drop policy if exists "Technicians view own compensation settings" on public.technician_compensation_settings;
create policy "Technicians view own compensation settings"
on public.technician_compensation_settings for select to authenticated
using (public.is_technician() and technician_id = auth.uid());

drop policy if exists "Office staff view compensation settings" on public.technician_compensation_settings;
create policy "Office staff view compensation settings"
on public.technician_compensation_settings for select to authenticated
using (public.is_office_staff());

revoke insert, update, delete on public.technician_compensation_settings from authenticated;
grant select on public.technician_compensation_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Extend technician_shifts with nullable payroll columns (additive only).
--    The existing duration/overlap/creator/fuel constraints are untouched.
-- ---------------------------------------------------------------------------
alter table public.technician_shifts
  add column if not exists work_date date,
  add column if not exists settlement_due_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists settlement_kind text check (settlement_kind in ('self', 'auto')),
  add column if not exists payable_minutes integer,
  add column if not exists compensation_mode text check (compensation_mode in ('percentage', 'hourly')),
  add column if not exists hourly_rate_cents bigint,
  add column if not exists payable_cents bigint;

-- One shift per ET civil day per technician. Rows without a work_date (not yet
-- attributed to a day) are exempt from the uniqueness guarantee.
create unique index if not exists technician_shifts_technician_work_date_uidx
  on public.technician_shifts (technician_id, work_date)
  where work_date is not null;

-- ---------------------------------------------------------------------------
-- 3. technician_pay_period_records
--    One row per technician per Friday–Thursday period; owns the
--    pending/approved lifecycle.
-- ---------------------------------------------------------------------------
create table if not exists public.technician_pay_period_records (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete restrict,
  period_start date not null,
  period_end_exclusive date not null,
  status text not null default 'pending'
    constraint technician_pay_period_records_status_check
    check (status in ('pending', 'approved')),
  total_payable_cents bigint not null default 0
    constraint technician_pay_period_records_total_check
    check (total_payable_cents >= 0),
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (technician_id, period_start),
  constraint technician_pay_period_records_period_check
    check (period_end_exclusive > period_start)
);

create index if not exists technician_pay_period_records_period_idx
  on public.technician_pay_period_records (period_start, period_end_exclusive);

alter table public.technician_pay_period_records enable row level security;

drop policy if exists "Technicians view own pay periods" on public.technician_pay_period_records;
create policy "Technicians view own pay periods"
on public.technician_pay_period_records for select to authenticated
using (public.is_technician() and technician_id = auth.uid());

drop policy if exists "Office staff view pay periods" on public.technician_pay_period_records;
create policy "Office staff view pay periods"
on public.technician_pay_period_records for select to authenticated
using (public.is_office_staff());

revoke insert, update, delete on public.technician_pay_period_records from authenticated;
grant select on public.technician_pay_period_records to authenticated;

-- ---------------------------------------------------------------------------
-- 4. technician_shift_corrections
--    Append-only audit of administrative corrections to a shift.
-- ---------------------------------------------------------------------------
create table if not exists public.technician_shift_corrections (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.technician_shifts(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  old_values jsonb not null,
  new_values jsonb not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists technician_shift_corrections_shift_idx
  on public.technician_shift_corrections (shift_id);

alter table public.technician_shift_corrections enable row level security;

drop policy if exists "Technicians view own shift corrections" on public.technician_shift_corrections;
create policy "Technicians view own shift corrections"
on public.technician_shift_corrections for select to authenticated
using (
  public.is_technician()
  and exists (
    select 1 from public.technician_shifts s
    where s.id = shift_id and s.technician_id = auth.uid()
  )
);

drop policy if exists "Office staff view shift corrections" on public.technician_shift_corrections;
create policy "Office staff view shift corrections"
on public.technician_shift_corrections for select to authenticated
using (public.is_office_staff());

revoke insert, update, delete on public.technician_shift_corrections from authenticated;
grant select on public.technician_shift_corrections to authenticated;
