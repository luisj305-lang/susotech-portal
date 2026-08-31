import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20260831010000_fleet_management.sql");
const types = read("../src/lib/fleet/types.ts");

const tables = [
  "fleet_vehicles",
  "fleet_vehicle_assignments",
  "fleet_insurance_policies",
  "fleet_insurance_payments",
  "fleet_maintenance_records",
  "fleet_odometer_readings",
  "fleet_expenses",
  "fleet_incidents",
  "fleet_documents",
  "fleet_settings",
];

for (const table of tables) {
  assert.match(migration, new RegExp(`create table public\\.${table}\\b`, "u"));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "u"));
  assert.match(migration, new RegExp(`Office staff manage ${table}[\\s\\S]*?on public\\.${table} for all`, "u"));
}

assert.match(migration, /create extension if not exists btree_gist with schema extensions/u);
assert.match(migration, /add column if not exists vehicle_id uuid references public\.fleet_vehicles\(id\) on delete set null/u);
assert.match(migration, /fleet_vehicle_assignments_vehicle_primary_no_overlap/u);
assert.match(migration, /fleet_vehicle_assignments_technician_primary_no_overlap/u);
assert.match(migration, /exclude using gist/u);
assert.match(migration, /assignment_role in \('primary', 'backup'\)/u);
assert.match(migration, /ends_on is null or ends_on >= starts_on/u);
assert.match(migration, /Fleet assignments require an active technician/u);

assert.match(migration, /create or replace function public\.can_access_fleet_vehicle/u);
assert.match(migration, /security definer[\s\S]*?set search_path = ''/u);
assert.match(migration, /a\.technician_id = check_user_id/u);
assert.match(migration, /a\.starts_on <= current_date/u);
assert.match(migration, /a\.ends_on is null or a\.ends_on >= current_date/u);

assert.match(migration, /Technicians view assigned fleet vehicles/u);
assert.match(migration, /Technicians view assigned fleet assignments/u);
assert.match(migration, /Technicians report assigned fleet odometer/u);
assert.match(migration, /Technicians report assigned fleet incidents/u);
assert.match(migration, /submitted_by = auth\.uid\(\)/u);
assert.match(migration, /reported_by = auth\.uid\(\)/u);
assert.match(migration, /public\.is_operational_worker\(\)/u);
assert.doesNotMatch(migration, /Technicians (?:insert|update|delete|manage) fleet_(?:insurance|maintenance|expenses|documents|vehicle_assignments)/u);

assert.match(migration, /amount_cents bigint not null check \(amount_cents >= 0\)/u);
assert.match(migration, /cost_cents bigint not null default 0 check \(cost_cents >= 0\)/u);
assert.match(migration, /reading_miles bigint not null check \(reading_miles >= 0\)/u);
assert.match(migration, /fleet_odometer_weekly_submission_unique_idx/u);
assert.match(migration, /current_odometer_miles bigint not null default 0/u);
assert.match(migration, /weekly_odometer_day smallint not null default 1/u);
assert.match(migration, /weekly_odometer_required boolean not null default false/u);
assert.match(migration, /alert_day_offsets smallint\[\] not null default array\[30, 14, 7, 0\]/u);

assert.match(migration, /insert into storage\.buckets \(id, name, public\)[\s\S]*?'fleet-documents', 'fleet-documents', false/u);
assert.match(migration, /Office staff manage fleet document objects/u);
assert.match(migration, /Technicians read assigned fleet document objects/u);
assert.doesNotMatch(migration, /Technicians (?:upload|insert|update|delete|manage) fleet document objects/u);

assert.match(migration, /create view public\.fleet_cost_ledger/u);
assert.match(migration, /with \(security_invoker = true\)/u);
assert.match(migration, /from public\.technician_shifts shift/u);
assert.doesNotMatch(migration, /create table public\.fleet_(?:fuel|shift_fuel)/u);
assert.doesNotMatch(migration, /grant select on public\.fleet_cost_ledger to authenticated/u);
assert.match(migration, /revoke all on public\.fleet_cost_ledger from authenticated/u);
assert.match(migration, /create or replace function public\.list_fleet_cost_ledger/u);
assert.match(migration, /if not public\.is_office_staff\(auth\.uid\(\)\) then[\s\S]*?raise exception 'Office access required'/u);
assert.match(migration, /grant execute on function public\.list_fleet_cost_ledger\(date, date, uuid\) to authenticated/u);
assert.match(migration, /add column if not exists source_key text/u);
assert.match(migration, /notifications_user_source_key_unique_idx/u);
assert.match(migration, /notifications_preserve_source_key_before_update/u);

assert.match(types, /export const FLEET_VEHICLE_STATUSES/u);
assert.match(types, /export type FleetVehicle/u);
assert.match(types, /export type FleetVehicleAssignment/u);
assert.match(types, /export type FleetInsurancePolicy/u);
assert.match(types, /export type FleetMaintenanceRecord/u);
assert.match(types, /export type FleetOdometerReading/u);
assert.match(types, /export type FleetIncident/u);
assert.match(types, /export type FleetSettings/u);
assert.match(types, /export type FleetCostLedgerEntry/u);
assert.match(types, /amount_cents: number/u);
assert.match(types, /odometer_miles: number/u);

const auditTypeBody = (name) => {
  const body = types.match(new RegExp(`export type ${name} = FleetAuditFields & \\{([\\s\\S]*?)\\n\\};`, "u"))?.[1];
  assert.ok(body, `${name} must extend FleetAuditFields`);
  return body;
};

const insurancePayment = auditTypeBody("FleetInsurancePayment");
assert.match(insurancePayment, /policy_id: string/u);
assert.match(insurancePayment, /paid_on: string/u);
assert.match(insurancePayment, /amount_cents: number/u);

const expense = auditTypeBody("FleetExpense");
assert.match(expense, /vehicle_id: string/u);
assert.match(expense, /expense_type: FleetExpenseType/u);
assert.match(expense, /occurred_on: string/u);
assert.match(expense, /amount_cents: number/u);
assert.match(expense, /description: string/u);

const document = auditTypeBody("FleetDocument");
assert.match(document, /vehicle_id: string/u);
assert.match(document, /document_type: FleetDocumentType/u);
assert.match(document, /bucket_id: "fleet-documents"/u);
assert.match(document, /storage_path: string/u);
assert.match(document, /mime_type: "application\/pdf" \| "image\/jpeg" \| "image\/png" \| "image\/webp"/u);
assert.match(document, /size_bytes: number/u);
assert.match(document, /uploaded_by: string/u);

console.log(`[fleet-schema-static] PASS tables=${tables.length} rls=office+assigned-technician ledger=office-rpc storage=private`);
