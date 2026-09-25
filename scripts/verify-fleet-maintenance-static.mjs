import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260917010000_fleet_engine_hours.sql");
const auditorEngineHoursMigration = read("supabase/migrations/20260917020000_auditor_fleet_engine_hours_read.sql");
const types = read("src/lib/fleet/types.ts");
const officeActions = read("src/lib/fleet/actions.ts");
const technicianActions = read("src/lib/fleet/technician-actions.ts");
const officeQueries = read("src/lib/fleet/queries.ts");
const technicianQueries = read("src/lib/fleet/technician-queries.ts");
const officeWorkspace = read("src/components/fleet/fleet-detail-sections.tsx");
const technicianWorkspace = read("src/components/fleet/technician-fleet-workspace.tsx");

function functionText(source, path, name, kind = ts.ScriptKind.TS) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const declaration = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration?.body, `${path}: missing function ${name}`);
  return declaration.getText(file);
}

assert.match(migration, /add column if not exists current_engine_hours bigint not null default 0/u);
assert.match(migration, /create table public\.fleet_engine_hour_readings/u);
assert.match(migration, /reading_hours bigint not null check \(reading_hours >= 0\)/u);
assert.match(migration, /source text not null check \(source in \('manual', 'technician'\)\)/u);
assert.match(migration, /create or replace function public\.fleet_validate_engine_hour_reading\(\)/u);
assert.match(migration, /for update/u);
assert.match(migration, /if new\.reading_hours < current_hours/u);
assert.match(migration, /create trigger fleet_engine_hours_advance_vehicle/u);
assert.match(migration, /current_engine_hours = greatest\(current_engine_hours, new\.reading_hours\)/u);
assert.match(migration, /alter table public\.fleet_engine_hour_readings enable row level security/u);
assert.match(migration, /Office staff report fleet engine hours/u);
assert.match(migration, /Technicians report assigned fleet engine hours/u);
assert.match(migration, /public\.is_technician\(\)[\s\S]*public\.can_access_fleet_vehicle\(vehicle_id, auth\.uid\(\)\)/u);
assert.match(migration, /grant select, insert on public\.fleet_engine_hour_readings to authenticated/u);
assert.doesNotMatch(migration, /grant (?:select, )?insert, update, delete on public\.fleet_engine_hour_readings/u);
assert.match(auditorEngineHoursMigration, /create policy "Office viewers view fleet engine hours"\s+on public\.fleet_engine_hour_readings for select to authenticated\s+using \(public\.is_office_viewer\(\)\)/u);
assert.doesNotMatch(auditorEngineHoursMigration, /\b(?:insert|update|delete|grant|revoke)\b/iu);

assert.match(types, /current_engine_hours: number/u);
assert.match(types, /export type FleetEngineHourReading/u);
assert.match(types, /reading_hours: number/u);

const officeEngineAction = functionText(officeActions, "actions.ts", "saveFleetEngineHoursAction");
assert.match(officeEngineAction, /await requireSupervisor\(\)/u);
assert.match(officeEngineAction, /current_engine_hours/u);
assert.match(officeEngineAction, /reading_hours/u);
assert.match(officeEngineAction, /from\("fleet_engine_hour_readings"\)\.insert/u);
assert.match(officeEngineAction, /revalidatePath\("\/camiones\/mi-camion"\)/u);

const technicianEngineAction = functionText(technicianActions, "technician-actions.ts", "submitMyFleetEngineHoursAction");
assert.match(technicianEngineAction, /await requireProfile\(\)/u);
assert.match(technicianEngineAction, /profile\.role !== "tecnico"/u);
assert.match(technicianEngineAction, /requireCurrentFleetAssignment/u);
assert.match(technicianEngineAction, /current_engine_hours/u);
assert.match(technicianEngineAction, /from\("fleet_engine_hour_readings"\)\.insert/u);
assert.match(technicianEngineAction, /source: "technician"/u);

assert.match(functionText(officeQueries, "queries.ts", "getFleetVehicleDetail"), /fleet_engine_hour_readings/u);
assert.match(functionText(technicianQueries, "technician-queries.ts", "getMyFleetWorkspace"), /fleet_engine_hour_readings/u);
assert.match(functionText(officeQueries, "queries.ts", "maintenanceSummary"), /record\.scheduled_for/u);
assert.match(functionText(technicianQueries, "technician-queries.ts", "maintenanceAlert"), /record\.scheduled_for/u);
assert.match(technicianWorkspace, /submitMyFleetEngineHoursAction/u);
assert.match(technicianWorkspace, /Registrar horas de motor/u);
assert.match(officeWorkspace, /saveFleetEngineHoursAction/u);
assert.match(officeWorkspace, /Historial de horas de motor/u);
assert.match(officeWorkspace, /Programar mantenimiento/u);
assert.match(officeWorkspace, /upcomingMaintenance/u);
assert.match(functionText(officeActions, "actions.ts", "saveFleetMaintenanceAction"), /Defina una fecha programada o un próximo vencimiento/u);

console.log("[fleet-maintenance-static] PASS engine-hours=monotonic-rbac-ui maintenance=schedule-crud-summary");
