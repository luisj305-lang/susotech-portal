-- Read-only 'auditor' office role: auditor sees everything a supervisor sees
-- but mutates nothing. The read/write split is the security boundary:
--   * READ surfaces move from is_office_staff() to is_office_viewer()
--     (is_office_viewer = is_office_staff OR active auditor).
--   * Every WRITE surface (with-check/insert/update/delete policies, write RPC
--     guards, can_mutate_job) stays on is_office_staff() / is_admin().
-- is_office_staff() is deliberately NOT widened to include 'auditor'.

-- ---------------------------------------------------------------------------
-- 1. Viewer predicate (staff OR active auditor).
-- ---------------------------------------------------------------------------
create or replace function public.is_office_viewer(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_office_staff(check_user_id)
    or exists (
      select 1
      from public.profiles p
      where p.id = check_user_id
        and p.role = 'auditor'
        and p.is_active
    );
$$;

revoke all on function public.is_office_viewer(uuid) from public;
grant execute on function public.is_office_viewer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. can_view_job: widen the office READ branch to is_office_viewer.
--    can_mutate_job stays on is_office_staff (unchanged). can_access_job already
--    delegates to can_view_job and inherits this change.
-- ---------------------------------------------------------------------------
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
  if public.is_office_viewer(check_user_id) then return true; end if;
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

-- ---------------------------------------------------------------------------
-- 3. SELECT-only RLS policies: is_office_staff() -> is_office_viewer().
-- ---------------------------------------------------------------------------

-- jobs
drop policy if exists "Office staff can view jobs" on public.jobs;
create policy "Office staff can view jobs"
on public.jobs for select to authenticated
using (public.is_office_viewer());

-- crews
drop policy if exists "Office staff can view crews" on public.crews;
create policy "Office staff can view crews"
on public.crews for select to authenticated
using (public.is_office_viewer());

-- crew_members
drop policy if exists "Office staff can view crew members" on public.crew_members;
create policy "Office staff can view crew members"
on public.crew_members for select to authenticated
using (public.is_office_viewer());

-- job_status_history
drop policy if exists "Office staff can view history" on public.job_status_history;
create policy "Office staff can view history"
on public.job_status_history for select to authenticated
using (public.is_office_viewer());

-- job_photos (keep the admin soft-delete audit branch)
drop policy if exists "Office staff view active photos and admin audit" on public.job_photos;
create policy "Office staff view active photos and admin audit"
on public.job_photos for select to authenticated
using (public.is_office_viewer() and (deleted_at is null or public.is_admin()));

-- job_stages
drop policy if exists "Office staff can view job stages" on public.job_stages;
create policy "Office staff can view job stages"
on public.job_stages for select to authenticated
using (public.is_office_viewer());

-- job_stage_events
drop policy if exists "Office staff can view job stage events" on public.job_stage_events;
create policy "Office staff can view job stage events"
on public.job_stage_events for select to authenticated
using (public.is_office_viewer());

-- price_categories (company rate stays admin-only)
drop policy if exists "Office staff can view price categories" on public.price_categories;
create policy "Office staff can view price categories"
on public.price_categories for select to authenticated
using (
  public.is_admin()
  or (public.is_office_viewer() and slug <> 'company')
);

-- production_code_rates (company rate stays admin-only)
drop policy if exists "Office staff can view production rates" on public.production_code_rates;
create policy "Office staff can view production rates"
on public.production_code_rates for select to authenticated
using (
  public.is_admin()
  or (
    public.is_office_viewer()
    and exists (
      select 1
      from public.price_categories pc
      where pc.id = price_category_id and pc.slug <> 'company'
    )
  )
);

-- production_code_catalog
drop policy if exists "Office staff can view production catalog" on public.production_code_catalog;
create policy "Office staff can view production catalog"
on public.production_code_catalog for select to authenticated
using (public.is_office_viewer());

-- production_catalog_sources
drop policy if exists "Office staff can view catalog sources" on public.production_catalog_sources;
create policy "Office staff can view catalog sources"
on public.production_catalog_sources for select to authenticated
using (public.is_office_viewer());

-- production_catalog_source_rows
drop policy if exists "Office staff can view catalog source rows" on public.production_catalog_source_rows;
create policy "Office staff can view catalog source rows"
on public.production_catalog_source_rows for select to authenticated
using (public.is_office_viewer());

-- technician_shifts
drop policy if exists "Office staff view technician shifts" on public.technician_shifts;
create policy "Office staff view technician shifts"
on public.technician_shifts for select to authenticated
using (public.is_office_viewer());

-- technician_compensation_settings
drop policy if exists "Office staff view compensation settings" on public.technician_compensation_settings;
create policy "Office staff view compensation settings"
on public.technician_compensation_settings for select to authenticated
using (public.is_office_viewer());

-- technician_pay_period_records
drop policy if exists "Office staff view pay periods" on public.technician_pay_period_records;
create policy "Office staff view pay periods"
on public.technician_pay_period_records for select to authenticated
using (public.is_office_viewer());

-- technician_shift_corrections
drop policy if exists "Office staff view shift corrections" on public.technician_shift_corrections;
create policy "Office staff view shift corrections"
on public.technician_shift_corrections for select to authenticated
using (public.is_office_viewer());

-- job_delivery_allocation_versions
drop policy if exists "Office staff view allocation versions" on public.job_delivery_allocation_versions;
create policy "Office staff view allocation versions"
on public.job_delivery_allocation_versions for select to authenticated
using (public.is_office_viewer());

-- job_delivery_financial_allocations
drop policy if exists "Office staff view financial allocations" on public.job_delivery_financial_allocations;
create policy "Office staff view financial allocations"
on public.job_delivery_financial_allocations for select to authenticated
using (public.is_office_viewer());

-- job_work_participants
drop policy if exists "Office staff view job work participants" on public.job_work_participants;
create policy "Office staff view job work participants"
on public.job_work_participants for select to authenticated
using (public.is_office_viewer());

-- manual_jobs (creator branch preserved)
drop policy if exists "manual_jobs_select" on public.manual_jobs;
create policy "manual_jobs_select"
on public.manual_jobs for select to authenticated
using (auth.uid() = created_by or public.is_office_viewer());

-- manual_job_workers (participant + creator branches preserved)
drop policy if exists "manual_job_workers_select" on public.manual_job_workers;
create policy "manual_job_workers_select"
on public.manual_job_workers for select to authenticated
using (
  auth.uid() = technician_id
  or public.is_office_viewer()
  or exists (
    select 1 from public.manual_jobs mj
    where mj.id = manual_job_id and mj.created_by = auth.uid()
  )
);

-- job_imports
drop policy if exists "Office staff can view import audit" on public.job_imports;
create policy "Office staff can view import audit"
on public.job_imports for select to authenticated
using (public.is_office_viewer());

-- job_import_batches (creator branch preserved)
drop policy if exists "Office reads own import batches" on public.job_import_batches;
create policy "Office reads own import batches"
on public.job_import_batches for select to authenticated
using (created_by = auth.uid() and public.is_office_viewer());

-- job_import_items (creator branch preserved)
drop policy if exists "Office reads own import items" on public.job_import_items;
create policy "Office reads own import items"
on public.job_import_items for select to authenticated
using (
  public.is_office_viewer()
  and exists (
    select 1 from public.job_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
  )
);

-- job_applications (legacy)
drop policy if exists "Office staff read legacy applications" on public.job_applications;
create policy "Office staff read legacy applications"
on public.job_applications for select to authenticated
using (public.is_office_viewer(auth.uid()));

-- recruitment_applications (submitted-state branch preserved)
drop policy if exists "Office staff read submitted applications" on public.recruitment_applications;
create policy "Office staff read submitted applications"
on public.recruitment_applications for select to authenticated
using (submission_state = 'submitted' and public.is_office_viewer(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Storage SELECT policies -> is_office_viewer(). Upload/update/delete stay
--    on is_office_staff() / is_admin().
-- ---------------------------------------------------------------------------

-- project-files read
drop policy if exists "Office staff can read project files" on storage.objects;
create policy "Office staff can read project files"
on storage.objects for select to authenticated
using (bucket_id = 'project-files' and public.is_office_viewer());

-- job-evidence read
drop policy if exists "Office staff can read job evidence objects" on storage.objects;
create policy "Office staff can read job evidence objects"
on storage.objects for select to authenticated
using (bucket_id = 'job-evidence' and public.is_office_viewer());

-- technician-shift-fuel read
drop policy if exists "Office staff read shift fuel photos" on storage.objects;
create policy "Office staff read shift fuel photos"
on storage.objects for select to authenticated
using (bucket_id = 'technician-shift-fuel' and public.is_office_viewer());

-- recruitment-resumes read
drop policy if exists "Office staff read submitted resumes" on storage.objects;
create policy "Office staff read submitted resumes"
on storage.objects for select to authenticated
using (
  bucket_id = 'recruitment-resumes'
  and public.is_office_viewer(auth.uid())
  and exists (
    select 1 from public.recruitment_applications a
    where a.resume_path = name and a.submission_state = 'submitted'
  )
);

-- ---------------------------------------------------------------------------
-- 5. Split mixed `for all is_office_staff()` policies: SELECT -> viewer,
--    insert/update/delete -> staff.
-- ---------------------------------------------------------------------------

-- job_assignments
drop policy if exists "Office staff can manage assignments" on public.job_assignments;
create policy "Office staff can view assignments"
on public.job_assignments for select to authenticated
using (public.is_office_viewer());
create policy "Office staff can insert assignments"
on public.job_assignments for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff can update assignments"
on public.job_assignments for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff can delete assignments"
on public.job_assignments for delete to authenticated
using (public.is_office_staff());

-- job_production_codes
drop policy if exists "Office staff can manage production codes" on public.job_production_codes;
create policy "Office staff can view production codes"
on public.job_production_codes for select to authenticated
using (public.is_office_viewer());
create policy "Office staff can insert production codes"
on public.job_production_codes for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff can update production codes"
on public.job_production_codes for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff can delete production codes"
on public.job_production_codes for delete to authenticated
using (public.is_office_staff());

-- fleet_vehicles
drop policy if exists "Office staff manage fleet_vehicles" on public.fleet_vehicles;
create policy "Office staff view fleet_vehicles"
on public.fleet_vehicles for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_vehicles"
on public.fleet_vehicles for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_vehicles"
on public.fleet_vehicles for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_vehicles"
on public.fleet_vehicles for delete to authenticated
using (public.is_office_staff());

-- fleet_vehicle_assignments
drop policy if exists "Office staff manage fleet_vehicle_assignments" on public.fleet_vehicle_assignments;
create policy "Office staff view fleet_vehicle_assignments"
on public.fleet_vehicle_assignments for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_vehicle_assignments"
on public.fleet_vehicle_assignments for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_vehicle_assignments"
on public.fleet_vehicle_assignments for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_vehicle_assignments"
on public.fleet_vehicle_assignments for delete to authenticated
using (public.is_office_staff());

-- fleet_insurance_policies
drop policy if exists "Office staff manage fleet_insurance_policies" on public.fleet_insurance_policies;
create policy "Office staff view fleet_insurance_policies"
on public.fleet_insurance_policies for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_insurance_policies"
on public.fleet_insurance_policies for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_insurance_policies"
on public.fleet_insurance_policies for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_insurance_policies"
on public.fleet_insurance_policies for delete to authenticated
using (public.is_office_staff());

-- fleet_insurance_payments
drop policy if exists "Office staff manage fleet_insurance_payments" on public.fleet_insurance_payments;
create policy "Office staff view fleet_insurance_payments"
on public.fleet_insurance_payments for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_insurance_payments"
on public.fleet_insurance_payments for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_insurance_payments"
on public.fleet_insurance_payments for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_insurance_payments"
on public.fleet_insurance_payments for delete to authenticated
using (public.is_office_staff());

-- fleet_maintenance_records
drop policy if exists "Office staff manage fleet_maintenance_records" on public.fleet_maintenance_records;
create policy "Office staff view fleet_maintenance_records"
on public.fleet_maintenance_records for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_maintenance_records"
on public.fleet_maintenance_records for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_maintenance_records"
on public.fleet_maintenance_records for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_maintenance_records"
on public.fleet_maintenance_records for delete to authenticated
using (public.is_office_staff());

-- fleet_odometer_readings
drop policy if exists "Office staff manage fleet_odometer_readings" on public.fleet_odometer_readings;
create policy "Office staff view fleet_odometer_readings"
on public.fleet_odometer_readings for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_odometer_readings"
on public.fleet_odometer_readings for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_odometer_readings"
on public.fleet_odometer_readings for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_odometer_readings"
on public.fleet_odometer_readings for delete to authenticated
using (public.is_office_staff());

-- fleet_expenses
drop policy if exists "Office staff manage fleet_expenses" on public.fleet_expenses;
create policy "Office staff view fleet_expenses"
on public.fleet_expenses for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_expenses"
on public.fleet_expenses for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_expenses"
on public.fleet_expenses for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_expenses"
on public.fleet_expenses for delete to authenticated
using (public.is_office_staff());

-- fleet_incidents
drop policy if exists "Office staff manage fleet_incidents" on public.fleet_incidents;
create policy "Office staff view fleet_incidents"
on public.fleet_incidents for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_incidents"
on public.fleet_incidents for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_incidents"
on public.fleet_incidents for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_incidents"
on public.fleet_incidents for delete to authenticated
using (public.is_office_staff());

-- fleet_documents
drop policy if exists "Office staff manage fleet_documents" on public.fleet_documents;
create policy "Office staff view fleet_documents"
on public.fleet_documents for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_documents"
on public.fleet_documents for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_documents"
on public.fleet_documents for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_documents"
on public.fleet_documents for delete to authenticated
using (public.is_office_staff());

-- fleet_settings
drop policy if exists "Office staff manage fleet_settings" on public.fleet_settings;
create policy "Office staff view fleet_settings"
on public.fleet_settings for select to authenticated
using (public.is_office_viewer());
create policy "Office staff insert fleet_settings"
on public.fleet_settings for insert to authenticated
with check (public.is_office_staff());
create policy "Office staff update fleet_settings"
on public.fleet_settings for update to authenticated
using (public.is_office_staff())
with check (public.is_office_staff());
create policy "Office staff delete fleet_settings"
on public.fleet_settings for delete to authenticated
using (public.is_office_staff());

-- fleet-documents storage bucket
drop policy if exists "Office staff manage fleet document objects" on storage.objects;
create policy "Office staff read fleet document objects"
on storage.objects for select to authenticated
using (bucket_id = 'fleet-documents' and public.is_office_viewer());
create policy "Office staff insert fleet document objects"
on storage.objects for insert to authenticated
with check (bucket_id = 'fleet-documents' and public.is_office_staff());
create policy "Office staff update fleet document objects"
on storage.objects for update to authenticated
using (bucket_id = 'fleet-documents' and public.is_office_staff())
with check (bucket_id = 'fleet-documents' and public.is_office_staff());
create policy "Office staff delete fleet document objects"
on storage.objects for delete to authenticated
using (bucket_id = 'fleet-documents' and public.is_office_staff());

-- ---------------------------------------------------------------------------
-- 6. calendar_reminders: add 'auditor' to the supervisor read predicate.
--    (Admin is intentionally excluded here today, so we do NOT switch this to
--    is_office_viewer.)
-- ---------------------------------------------------------------------------
drop policy if exists "Active supervisors can view calendar reminders" on public.calendar_reminders;
create policy "Active supervisors can view calendar reminders"
on public.calendar_reminders
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('supervisor', 'auditor')
      and p.is_active
  )
);

-- ---------------------------------------------------------------------------
-- 7. Read-only office RPCs: is_office_staff -> is_office_viewer (create or
--    replace preserves grants; return types/columns unchanged).
-- ---------------------------------------------------------------------------

create or replace function public.list_active_technicians_for_office()
returns table (id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then
    raise exception 'Only active office staff can list technicians' using errcode = '42501';
  end if;
  return query select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email) as label
  from public.profiles p
  where p.role = 'tecnico'
    and p.is_active
  order by coalesce(nullif(btrim(p.full_name), ''), p.email), p.id;
end;
$$;

create or replace function public.list_technician_shift_status()
returns table(
  technician_id uuid,
  technician_name text,
  shift_id uuid,
  started_at timestamptz,
  active_until timestamptz,
  is_shift_active boolean,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then
    raise exception 'Office access required';
  end if;
  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    latest.id, latest.started_at, latest.active_until,
    coalesce(latest.active_until > now() and latest.started_at <= now(), false),
    now()
  from public.profiles p
  left join lateral (
    select s.id, s.started_at, s.active_until
    from public.technician_shifts s
    where s.technician_id = p.id
    order by s.started_at desc
    limit 1
  ) latest on true
  where p.role = 'tecnico' and p.is_active
  order by coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

create or replace function public.list_profiles_for_office()
returns table(
  id uuid, email text, full_name text, role public.user_role, is_active boolean,
  price_category_id uuid, price_category_name text, worker_specialty text,
  phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  return query
  select p.id, p.email, p.full_name, p.role, p.is_active,
    pc.id, pc.name, p.worker_specialty, p.phone
  from public.profiles p
  left join public.price_categories pc on pc.id = p.price_category_id
  order by p.full_name nulls last, p.email, p.id;
end;
$$;

create or replace function public.get_production_report(p_start_date date, p_end_date date)
returns table(
  production_date date, technician_id uuid, technician_name text,
  code text, description text, unit text, quantity numeric,
  unit_rate numeric, amount numeric, billing_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366
  then raise exception 'Invalid date range'; end if;
  starts_at := p_start_date::timestamp at time zone 'America/New_York';
  ends_at := (p_end_date + 1)::timestamp at time zone 'America/New_York';

  return query
  select (l.credited_at at time zone 'America/New_York')::date,
    l.credited_technician_id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    l.code, coalesce(c.description, legacy_catalog.description, l.code),
    l.unit_snapshot, l.quantity, l.unit_rate_snapshot, l.amount_snapshot,
    case when j.main_status in ('aprobado','listo_pagar','pagado')
      then 'confirmed' else 'pending' end
  from public.job_delivery_production_lines l
  join public.job_deliveries d
    on d.id = l.delivery_id and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = l.job_id
  join public.profiles p on p.id = l.credited_technician_id
  left join public.job_pdf_annotations a on a.id = l.source_annotation_id
  left join public.production_code_catalog c on c.id = a.catalog_id
  left join public.job_production_codes legacy on legacy.id = l.legacy_production_code_id
  left join public.production_code_catalog legacy_catalog on legacy_catalog.id = legacy.catalog_id
  where l.credited_at >= starts_at and l.credited_at < ends_at
  order by 1 desc, 3, l.code;
end;
$$;

create or replace function public.get_financial_allocation_report(p_start_date date, p_end_date date)
returns table(
  allocation_date date, job_id uuid, delivery_id uuid, prism_number text,
  participant_id uuid, participant_name text, worker_specialty text,
  percentage_basis_points integer, allocated_cents bigint,
  source_amount_cents bigint, billing_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366 then raise exception 'Invalid date range'; end if;
  return query
  select (d.confirmed_at at time zone 'America/New_York')::date,
    v.job_id, v.delivery_id, j.prism_number,
    a.participant_id, a.participant_name_snapshot, a.worker_specialty_snapshot,
    a.percentage_basis_points, a.allocated_cents, v.source_amount_cents,
    case when j.main_status in ('aprobado', 'listo_pagar', 'pagado')
      then 'confirmed' else 'pending' end
  from public.job_delivery_financial_allocations a
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
    and v.superseded_at is null and v.voided_at is null
  join public.job_deliveries d on d.id = v.delivery_id
    and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = v.job_id and j.current_delivery_id = d.id
  where (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
  order by 1 desc, a.participant_name_snapshot, v.job_id;
end;
$$;

create or replace function public.get_worker_weekly_financial_dashboard(p_reference_at timestamptz default clock_timestamp())
returns table(
  participant_id uuid,
  allocated_cents bigint,
  allocation_count bigint,
  week_start_at timestamptz,
  week_end_exclusive_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  as_of timestamptz := coalesce(p_reference_at, clock_timestamp());
  local_date date := (as_of at time zone 'America/New_York')::date;
  start_date date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  start_date := local_date - ((extract(dow from local_date)::integer + 2) % 7);
  starts_at := start_date::timestamp at time zone 'America/New_York';
  ends_at := (start_date + 7)::timestamp at time zone 'America/New_York';
  return query
  select a.participant_id, sum(a.allocated_cents)::bigint, count(*)::bigint, starts_at, ends_at
  from public.job_delivery_financial_allocations a
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
    and v.superseded_at is null and v.voided_at is null
  join public.job_deliveries d on d.id = v.delivery_id
    and d.submitted and d.superseded_at is null
  join public.jobs j on j.id = v.job_id and j.current_delivery_id = d.id
  where d.confirmed_at >= starts_at and d.confirmed_at < ends_at
  group by a.participant_id

  union all

  select mw.technician_id, sum(round((mw.percentage_basis_points * mj.value_cents) / 10000.0))::bigint, count(*)::bigint, starts_at, ends_at
  from public.manual_job_workers mw
  join public.manual_jobs mj on mj.id = mw.manual_job_id and mj.status = 'approved'
  where mj.reviewed_at >= starts_at and mj.reviewed_at < ends_at
  group by mw.technician_id;
end;
$$;

create or replace function public.get_worker_operations_dashboard(
  p_reference_at timestamptz default clock_timestamp()
)
returns table(
  technician_id uuid,
  technician_name text,
  crew_names text[],
  is_shift_active boolean,
  shift_started_at timestamptz,
  shift_active_until timestamptz,
  weekly_production numeric,
  weekly_production_amount numeric,
  weekly_production_company_amount numeric,
  weekly_delivered_jobs bigint,
  weekly_fuel_amount numeric,
  fuel_daily jsonb,
  production_breakdown jsonb,
  server_now timestamptz,
  week_start_at timestamptz,
  week_end_exclusive_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  as_of timestamptz := coalesce(p_reference_at, clock_timestamp());
  local_date date;
  start_date date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  local_date := (as_of at time zone 'America/New_York')::date;
  start_date := local_date - ((extract(dow from local_date)::integer + 2) % 7);
  starts_at := start_date::timestamp at time zone 'America/New_York';
  ends_at := (start_date + 7)::timestamp at time zone 'America/New_York';

  return query
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email),
    coalesce(crews.names, '{}'::text[]),
    coalesce(latest.started_at <= as_of and latest.active_until > as_of, false)
      or coalesce(companion_active.active, false),
    latest.started_at, latest.active_until,
    coalesce(production.total_quantity, 0)::numeric,
    coalesce(production.total_amount, 0)::numeric,
    coalesce(production.total_company_amount, 0)::numeric,
    coalesce(delivered.delivered_jobs, 0)::bigint,
    coalesce(fuel.total_amount, 0)::numeric,
    coalesce(fuel_daily.items, '[]'::jsonb),
    coalesce(breakdown.items, '[]'::jsonb),
    as_of, starts_at, ends_at
  from public.profiles p
  left join lateral (
    select array_agg(distinct c.name order by c.name) as names
    from public.crews c
    left join public.crew_members cm on cm.crew_id = c.id
    where c.is_active and (c.lead_technician_id = p.id or cm.technician_id = p.id)
  ) crews on true
  left join lateral (
    select s.started_at, s.active_until
    from public.technician_shifts s
    where s.technician_id = p.id
    order by s.started_at desc limit 1
  ) latest on true
  left join lateral (
    select exists (
      select 1 from public.technician_shift_companions c
      join public.technician_shifts s on s.id = c.shift_id
      where c.technician_id = p.id
        and s.started_at <= as_of
        and s.active_until > as_of
    ) as active
  ) companion_active on true
  left join lateral (
    select
      sum(l.quantity) as total_quantity,
      sum(l.amount_snapshot) as total_amount,
      sum(l.quantity * coalesce(cr.unit_price, 0)) as total_company_amount
    from public.job_delivery_production_lines l
    join public.job_deliveries d on d.id = l.delivery_id
    left join lateral (
      select r.unit_price
      from public.production_code_rates r
      join public.price_categories pc on pc.id = r.price_category_id
      where pc.slug = 'company'
        and r.active
        and r.effective_from <= current_date
        and r.catalog_item_id = l.catalog_item_id
      order by r.effective_from desc
      limit 1
    ) cr on true
    where l.credited_technician_id = p.id
      and d.submitted and d.superseded_at is null
      and l.credited_at >= starts_at and l.credited_at < ends_at
  ) production on true
  left join lateral (
    select count(distinct d.job_id) as delivered_jobs
    from public.job_deliveries d
    where d.delivered_by = p.id
      and d.submitted and d.superseded_at is null
      and d.confirmed_at >= starts_at and d.confirmed_at < ends_at
  ) delivered on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'code', grouped.code, 'unit', grouped.unit_snapshot,
      'quantity', grouped.quantity
    ) order by grouped.code, grouped.unit_snapshot) as items
    from (
      select l.code, l.unit_snapshot, sum(l.quantity) as quantity
      from public.job_delivery_production_lines l
      join public.job_deliveries d on d.id = l.delivery_id
      where l.credited_technician_id = p.id
        and d.submitted and d.superseded_at is null
        and l.credited_at >= starts_at and l.credited_at < ends_at
      group by l.code, l.unit_snapshot
    ) grouped
  ) breakdown on true
  left join lateral (
    select sum(s.fuel_amount) as total_amount
    from public.technician_shifts s
    where s.technician_id = p.id
      and s.started_at >= starts_at and s.started_at < ends_at
  ) fuel on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'date', (s.started_at at time zone 'America/New_York')::date,
      'amount', s.fuel_amount,
      'no_fuel', coalesce(s.no_fuel_today, false)
    ) order by s.started_at) as items
    from public.technician_shifts s
    where s.technician_id = p.id
      and s.started_at >= starts_at and s.started_at < ends_at
  ) fuel_daily on true
  where p.role = 'tecnico' and p.is_active
  order by coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

create or replace function public.list_job_archive_events_for_office(p_job_id uuid)
returns table(
  id uuid, event_type text, reason_code text, notes text, actor_id uuid,
  actor_name text, occurred_at timestamptz, is_legacy boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  if not exists (select 1 from public.jobs j where j.id = p_job_id) then
    raise exception 'Job unavailable';
  end if;
  return query
  select e.id, e.event_type, e.reason_code, e.notes, e.actor_id,
    coalesce(nullif(btrim(p.full_name), ''), p.email), e.occurred_at, e.is_legacy
  from public.job_archive_events e
  left join public.profiles p on p.id = e.actor_id
  where e.job_id = p_job_id
  order by e.occurred_at desc, e.id desc;
end;
$$;

create or replace function public.list_manual_jobs_for_office()
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
begin
  if not public.is_office_viewer(auth.uid()) then
    raise exception 'Office access required';
  end if;
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
      'percentageBasisPoints', mw.percentage_basis_points
    ) order by mw.percentage_basis_points desc) as workers
    from public.manual_job_workers mw
    join public.profiles p on p.id = mw.technician_id
    where mw.manual_job_id = mj.id
  ) w on true
  order by case mj.status when 'pending' then 0 when 'approved' then 1 else 2 end, mj.created_at desc;
end;
$$;

create or replace function public.get_financial_history(p_start_date date, p_end_date date)
returns table(bucket_date date, income_cents bigint, worker_expense_cents bigint, fuel_expense_cents bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 366 then raise exception 'Invalid date range'; end if;
  return query
  with dates as (
    select generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day')::date as d
  ),
  income as (
    select (d.confirmed_at at time zone 'America/New_York')::date as d, coalesce(sum(v.source_amount_cents), 0)::bigint as cents
    from public.job_delivery_allocation_versions v
    join public.job_deliveries d on d.id = v.delivery_id and d.submitted and d.superseded_at is null
    where v.superseded_at is null and v.voided_at is null
      and (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ),
  worker_expense as (
    select (d.confirmed_at at time zone 'America/New_York')::date as d, coalesce(sum(a.allocated_cents), 0)::bigint as cents
    from public.job_delivery_financial_allocations a
    join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id and v.superseded_at is null and v.voided_at is null
    join public.job_deliveries d on d.id = v.delivery_id and d.submitted and d.superseded_at is null
    where (d.confirmed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ),
  fuel_expense as (
    select (s.started_at at time zone 'America/New_York')::date as d, coalesce((sum(s.fuel_amount) * 100)::bigint, 0)::bigint as cents
    from public.technician_shifts s
    where (s.started_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  ),
  manual as (
    select (mj.reviewed_at at time zone 'America/New_York')::date as d,
           coalesce(sum(mj.value_cents), 0)::bigint as worker_cents
    from public.manual_jobs mj
    where mj.status = 'approved'
      and (mj.reviewed_at at time zone 'America/New_York')::date between p_start_date and p_end_date
    group by 1
  )
  select dates.d,
    coalesce(income.cents, 0) as income_cents,
    coalesce(worker_expense.cents, 0) + coalesce(manual.worker_cents, 0) as worker_expense_cents,
    coalesce(fuel_expense.cents, 0) as fuel_expense_cents
  from dates
  left join income on income.d = dates.d
  left join worker_expense on worker_expense.d = dates.d
  left join fuel_expense on fuel_expense.d = dates.d
  left join manual on manual.d = dates.d
  order by dates.d;
end;
$$;

create or replace function public.list_job_financial_allocations(p_job_id uuid)
returns table(
  allocation_version_id uuid,
  delivery_id uuid,
  job_id uuid,
  version integer,
  participant_id uuid,
  percentage_basis_points integer,
  allocated_cents bigint,
  source_amount_cents bigint,
  participant_name text,
  worker_specialty text,
  created_at timestamptz,
  is_current boolean,
  state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then
    raise exception 'Office access required';
  end if;
  return query
  select v.id, v.delivery_id, v.job_id, v.version,
    a.participant_id,
    a.percentage_basis_points, a.allocated_cents, v.source_amount_cents,
    a.participant_name_snapshot, a.worker_specialty_snapshot, v.created_at,
    (j.current_delivery_id = v.delivery_id and d.superseded_at is null
      and v.superseded_at is null and v.voided_at is null),
    case when v.voided_at is not null then 'voided'
      when v.superseded_at is not null then 'superseded'
      else 'current' end
  from public.job_delivery_financial_allocations a
  join public.job_delivery_allocation_versions v on v.id = a.allocation_version_id
  join public.job_deliveries d on d.id = v.delivery_id
  join public.jobs j on j.id = v.job_id
  where v.job_id = p_job_id
  order by v.created_at desc, v.version desc, a.allocation_order;
end;
$$;

create or replace function public.list_technician_assigned_jobs(p_technician_id uuid)
returns table(
  id uuid,
  prism_number text,
  title text,
  address text,
  main_status text,
  deadline_date timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then
    raise exception 'Office access required';
  end if;
  return query
  select j.id, j.prism_number, j.title, j.address, j.main_status::text, j.deadline_date, j.updated_at, j.archived_at
  from public.jobs j
  join public.job_assignments ja on ja.job_id = j.id and ja.active and ja.is_primary
  where (
      (ja.assignee_type = 'technician' and ja.technician_id = p_technician_id)
      or (
        ja.assignee_type = 'crew' and exists (
          select 1 from public.crews c
          where c.id = ja.crew_id and c.is_active
            and (c.lead_technician_id = p_technician_id or exists (
              select 1 from public.crew_members cm
              where cm.crew_id = c.id and cm.technician_id = p_technician_id
            ))
        )
      )
    )
  order by j.updated_at desc;
end;
$$;

create or replace function public.list_technician_assigned_jobs(
  p_technician_id uuid,
  p_week_start_at timestamptz,
  p_week_end_exclusive_at timestamptz
)
returns table(
  id uuid,
  prism_number text,
  title text,
  address text,
  main_status text,
  deadline_date timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_viewer(auth.uid()) then
    raise exception 'Office access required';
  end if;
  if p_technician_id is null
    or p_week_start_at is null or p_week_end_exclusive_at is null
    or not isfinite(p_week_start_at) or not isfinite(p_week_end_exclusive_at)
    or extract(dow from p_week_start_at at time zone 'America/New_York') <> 5
    or (p_week_start_at at time zone 'America/New_York')::time <> time '00:00:00'
    or p_week_end_exclusive_at <> (
      (p_week_start_at at time zone 'America/New_York') + interval '7 days'
    ) at time zone 'America/New_York'
  then
    raise exception 'Invalid worker assignment week';
  end if;

  return query
  select j.id, j.prism_number, j.title, j.address, j.main_status::text, j.deadline_date, j.updated_at, j.archived_at
  from public.jobs j
  join public.job_assignments ja on ja.job_id = j.id and ja.active and ja.is_primary
  where ja.assigned_at >= p_week_start_at
    and ja.assigned_at < p_week_end_exclusive_at
    and (
      (ja.assignee_type = 'technician' and ja.technician_id = p_technician_id)
      or (
        ja.assignee_type = 'crew' and exists (
          select 1 from public.crews c
          where c.id = ja.crew_id and c.is_active
            and (c.lead_technician_id = p_technician_id or exists (
              select 1 from public.crew_members cm
              where cm.crew_id = c.id and cm.technician_id = p_technician_id
            ))
        )
      )
    )
  order by j.updated_at desc;
end;
$$;

create or replace function public.get_weekly_invoiced_total(
  p_reference_at timestamptz default clock_timestamp()
)
returns table(invoiced_cents bigint, delivered_jobs bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  as_of timestamptz := coalesce(p_reference_at, clock_timestamp());
  local_date date;
  start_date date;
  starts_at timestamptz;
  ends_at timestamptz;
begin
  if not public.is_office_viewer(auth.uid()) then raise exception 'Office access required'; end if;
  local_date := (as_of at time zone 'America/New_York')::date;
  start_date := local_date - ((extract(dow from local_date)::integer + 2) % 7);
  starts_at := start_date::timestamp at time zone 'America/New_York';
  ends_at := (start_date + 7)::timestamp at time zone 'America/New_York';
  return query
  select
    coalesce(sum(v.source_amount_cents), 0)::bigint,
    count(distinct d.job_id)::bigint
  from public.job_deliveries d
  join public.job_delivery_allocation_versions v
    on v.delivery_id = d.id
    and v.superseded_at is null and v.voided_at is null
  where d.submitted and d.superseded_at is null
    and d.confirmed_at >= starts_at and d.confirmed_at < ends_at;
end;
$$;

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
  if not public.is_office_viewer(auth.uid()) then
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
