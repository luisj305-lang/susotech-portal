import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260831020000_fleet_shift_association.sql");
const page = read("app/camiones/mi-camion/page.tsx");
const queries = read("src/lib/fleet/technician-queries.ts");
const actions = read("src/lib/fleet/technician-actions.ts");
const workspace = read("src/components/fleet/technician-fleet-workspace.tsx");
const dashboard = read("src/components/dashboard-client.tsx");
const shiftPage = read("app/jornada/iniciar/page.tsx");
const shiftForm = read("src/components/work-shifts/start-shift-form.tsx");
const shiftPrompt = read("src/components/work-shifts/shift-start-prompt.tsx");
const shiftAccess = read("src/lib/work-shifts/access.ts");
const shiftTypes = read("src/lib/work-shifts/types.ts");
const shiftStatus = read("src/components/technician/shift-status-card.tsx");
const officeActions = read("src/lib/fleet/actions.ts");
const officeQueries = read("src/lib/fleet/queries.ts");
const officeSections = read("src/components/fleet/fleet-detail-sections.tsx");

function functionText(source, path, name, kind = ts.ScriptKind.TS) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const declaration = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration?.body, `${path}: missing function ${name}`);
  return declaration.getText(file);
}

assert.match(page, /await requireProfile\(\)/u);
assert.match(page, /profile\.role !== "tecnico"/u);
assert.match(page, /redirect\("\/dashboard"\)/u);
assert.match(page, /await getMyFleetWorkspace\(\)/u);
assert.match(page, /<TechnicianAppShell/u);
assert.match(page, /<TechnicianFleetWorkspace/u);
assert.match(dashboard, /profile\.role === "tecnico"[\s\S]*href="\/camiones\/mi-camion"[\s\S]*Mi camión/u);

for (const query of ["getMyFleetWorkspace", "getMyPrimaryVehicleLabel"]) {
  const body = functionText(queries, "technician-queries.ts", query);
  assert.match(body, /await requireProfile\(\)/u, `${query}: missing authentication`);
  assert.match(body, /profile\.role !== "tecnico"/u, `${query}: missing technician authorization`);
  assert.doesNotMatch(body, /currentDate\(defaultSettings\.timezone\)/u, `${query}: assignment date must not use the fallback timezone`);
  const settingsLookup = body.indexOf('from("fleet_settings")');
  const configuredDate = body.indexOf("currentDate(settings.timezone)");
  const assignmentLookup = body.indexOf('from("fleet_vehicle_assignments")');
  assert.ok(settingsLookup >= 0 && configuredDate > settingsLookup && assignmentLookup > configuredDate, `${query}: resolve settings and configured date before assignment lookup`);
}
assert.match(queries, /from\("fleet_settings"\)/u);
assert.match(queries, /weekly_odometer_day/u);
assert.match(queries, /weekly_odometer_required/u);
assert.match(queries, /weekStartMonday/u);
assert.match(queries, /createSignedUrl/u);
const weeklyStatus = functionText(queries, "technician-queries.ts", "weeklyStatus");
assert.match(weeklyStatus, /weekEndSunday/u);
assert.match(weeklyStatus, /latestReading\.recorded_on >= weekStartMonday/u);
assert.match(weeklyStatus, /latestReading\.recorded_on <= weekEndSunday/u);
const workspaceQuery = functionText(queries, "technician-queries.ts", "getMyFleetWorkspace");
assert.match(workspaceQuery, /\.gte\("recorded_on", weekStartMonday\)/u);
assert.match(workspaceQuery, /\.lte\("recorded_on", weekEndSunday\)/u);

for (const action of ["submitMyFleetOdometerAction", "reportMyFleetIncidentAction"]) {
  const body = functionText(actions, "technician-actions.ts", action);
  assert.match(body, /await requireProfile\(\)/u, `${action}: missing authentication`);
  assert.match(body, /profile\.role !== "tecnico"/u, `${action}: missing technician authorization`);
  assert.match(body, /requireCurrentFleetAssignment/u, `${action}: missing current-assignment validation`);
  assert.match(body, /assertInsertedRow/u, `${action}: missing inserted-row verification`);
}
assert.match(workspace, /weekly\.required/u);
assert.match(workspace, /weekly\.completed/u);
assert.match(workspace, /weekly\.due/u);
assert.match(workspace, /submitMyFleetOdometerAction/u);
assert.match(workspace, /reportMyFleetIncidentAction/u);

assert.match(migration, /create or replace function public\.start_technician_shift\(\s*p_no_fuel_today boolean,\s*p_fuel_amount numeric,\s*p_fuel_photo_path text default null\s*\)/u);
const startRpc = migration.slice(migration.indexOf("create or replace function public.start_technician_shift"), migration.indexOf("create or replace function public.get_my_active_shift_with_vehicle"));
assert.match(startRpc, /from public\.fleet_vehicle_assignments/u);
assert.match(startRpc, /assignment_role = 'primary'/u);
assert.match(startRpc, /a\.starts_on <= current_date/u);
assert.match(startRpc, /vehicle_id[\s\S]*primary_vehicle_id/u);
assert.match(startRpc, /insert into public\.technician_shifts/u);
assert.doesNotMatch(startRpc, /p_vehicle_id/u);
assert.match(migration, /create or replace function public\.get_my_active_shift_with_vehicle\(\)/u);
assert.match(migration, /create or replace function public\.set_technician_shift_vehicle\(/u);
assert.match(migration, /if not public\.is_office_staff\(auth\.uid\(\)\)/u);
assert.match(migration, /set search_path = ''/u);

assert.match(shiftPage, /getMyPrimaryVehicleLabel/u);
assert.match(shiftForm, /Sin camión asignado/u);
assert.match(shiftForm, /vehicleLabel/u);
assert.doesNotMatch(shiftForm, /<(?:select|input)[^>]+name="[^"]*vehicle/iu);
assert.match(shiftPrompt, /vehicleLabel/u);
assert.match(shiftAccess, /get_my_active_shift_with_vehicle/u);
assert.match(shiftTypes, /vehicle_id: string \| null/u);
assert.match(shiftTypes, /vehicle_unit_number: string \| null/u);
assert.match(shiftStatus, /Sin camión asignado/u);

const officeCorrection = functionText(officeActions, "actions.ts", "setFleetShiftVehicleAction");
assert.match(officeCorrection, /await requireSupervisor\(\)/u);
assert.match(officeCorrection, /rpc\("set_technician_shift_vehicle"/u);
assert.match(officeCorrection, /data\?\.\[0\]/u);
assert.match(officeQueries, /shiftAssociations/u);
assert.match(officeSections, /setFleetShiftVehicleAction/u);
assert.match(officeSections, /Asociación de jornadas/u);

console.log("[fleet-technician-static] PASS route=authorized assignment-validation=server weekly-prompt=configured shift-binding=atomic selector=absent office-correction=present");
