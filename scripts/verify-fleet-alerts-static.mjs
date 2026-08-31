import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260831030000_fleet_alert_automation.sql");
const route = read("app/api/cron/fleet-alerts/route.ts");
const actions = read("src/lib/fleet/actions.ts");
const queries = read("src/lib/fleet/queries.ts");
const page = read("app/camiones/page.tsx");
const sections = read("src/components/fleet/fleet-detail-sections.tsx");
const types = read("src/lib/fleet/types.ts");
const vercelConfig = JSON.parse(read("vercel.json"));

function functionText(source, path, name, kind = ts.ScriptKind.TS) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const declaration = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration?.body, `${path}: missing function ${name}`);
  return declaration.getText(file);
}

assert.match(migration, /add column if not exists payment_due_on date/u);
assert.match(migration, /create or replace function public\.fleet_alert_offsets_are_valid\(offsets smallint\[\]\)/u);
assert.match(migration, /value not between 0 and 365/u);
assert.match(migration, /count\(distinct value\)/u);
assert.match(migration, /check \(public\.fleet_alert_offsets_are_valid\(alert_day_offsets\)\)/u);
assert.match(migration, /create or replace function public\.generate_fleet_alerts\(\)/u);
assert.match(migration, /security definer\s+set search_path = ''/u);
assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/u);
assert.match(migration, /not coalesce\(public\.is_office_staff\(auth\.uid\(\)\), false\)/u);
assert.match(migration, /revoke all on function public\.generate_fleet_alerts\(\) from public/u);
assert.match(migration, /grant execute on function public\.generate_fleet_alerts\(\) to authenticated, service_role/u);
assert.match(migration, /array\[30, 14, 7, 0\]::smallint\[\]/u);
assert.match(migration, /policy\.status = 'active'[\s\S]*policy\.expires_on - v_today = any\(v_alert_day_offsets\)/u);
assert.match(migration, /policy\.payment_due_on - v_today = any\(v_alert_day_offsets\)/u);
assert.match(migration, /coalesce\(payments\.paid_cents, 0\) < policy\.premium_cents/u);
assert.match(migration, /maintenance_due_on - v_today = any\(v_alert_day_offsets\)/u);
assert.match(migration, /v_mileage_warning_miles constant bigint := 500/u);
assert.match(migration, /vehicle\.current_odometer_miles >= maintenance\.next_due_odometer_miles - v_mileage_warning_miles/u);
assert.match(migration, /document\.expires_on - v_today = any\(v_alert_day_offsets\)/u);
assert.match(migration, /profile\.role in \('admin', 'supervisor'\)[\s\S]*profile\.is_active/u);
assert.match(migration, /assignment\.assignment_role = 'primary'/u);
assert.match(migration, /extract\(dow from v_today\)::smallint = v_weekly_odometer_day/u);
assert.match(migration, /not exists \([\s\S]*from public\.fleet_odometer_readings/u);
assert.match(migration, /reading\.recorded_on between v_week_start and v_week_end/u);
assert.match(migration, /clock_timestamp\(\) at time zone v_timezone/u);
for (const key of ["insurance-expiration", "insurance-payment", "maintenance-date", "maintenance-mileage", "document-expiration", "weekly-odometer"]) {
  assert.match(migration, new RegExp(`fleet:${key}:`, "u"), `missing deterministic source key for ${key}`);
}
for (const link of ["?tab=seguro", "?tab=mantenimiento", "?tab=documentos", "/camiones/mi-camion"]) {
  assert.match(migration, new RegExp(link.replace("?", "\\?"), "u"), `missing notification link ${link}`);
}
assert.match(migration, /on conflict \(user_id, source_key\) where source_key is not null do nothing/u);
assert.match(migration, /generated_count/u);
assert.match(migration, /skipped_count/u);

const cron = functionText(route, "route.ts", "GET");
const secretCheck = cron.indexOf("process.env.CRON_SECRET");
const serviceClient = cron.indexOf("createServiceClient()");
assert.ok(secretCheck >= 0 && serviceClient > secretCheck, "cron must authenticate before creating the service client");
assert.match(cron, /authorization !== `Bearer \$\{secret\}`/u);
assert.match(cron, /status: 401/u);
assert.match(cron, /rpc\("generate_fleet_alerts"\)/u);
assert.match(cron, /generated/u);
assert.match(cron, /skipped/u);

const manualAction = functionText(actions, "actions.ts", "runFleetAlertsAction");
assert.match(manualAction, /await requireSupervisor\(\)/u);
assert.match(manualAction, /rpc\("generate_fleet_alerts"\)/u);
assert.match(manualAction, /if \(error \|\| !result\)/u);
assert.match(manualAction, /generated_count/u);
assert.match(manualAction, /skipped_count/u);
assert.match(manualAction, /revalidateFleet\(\)/u);

const settingsAction = functionText(actions, "actions.ts", "saveFleetSettingsAction");
assert.match(settingsAction, /await requireSupervisor\(\)/u);
assert.match(settingsAction, /weekly_odometer_day/u);
assert.match(settingsAction, /weekly_odometer_required/u);
assert.match(settingsAction, /new Intl\.DateTimeFormat/u);
assert.match(settingsAction, /value\(formData, "alert_day_offsets"\)/u);
assert.match(settingsAction, /\.split\(","\)/u);
assert.match(settingsAction, /new Set\(offsets\)/u);
assert.match(settingsAction, /offsets\.length > 10/u);
assert.match(settingsAction, /offset < 0 \|\| offset > 365/u);
assert.match(settingsAction, /uniqueOffsets\.length !== offsets\.length/u);
assert.match(settingsAction, /from\("fleet_settings"\)\.upsert/u);
assert.match(settingsAction, /onConflict: "id"/u);
assert.match(settingsAction, /alert_day_offsets: uniqueOffsets/u);

const settingsQuery = functionText(queries, "queries.ts", "getFleetSettings");
assert.match(settingsQuery, /await requireSupervisor\(\)/u);
assert.match(settingsQuery, /from\("fleet_settings"\)/u);
assert.match(page, /await Promise\.all\([\s\S]*getFleetSettings\(\)/u);
assert.match(page, /action=\{saveFleetSettingsAction\}/u);
assert.match(page, /name="weekly_odometer_day"/u);
assert.match(page, /name="weekly_odometer_required"/u);
assert.match(page, /name="timezone"/u);
assert.match(page, /name="alert_day_offsets"/u);
assert.match(page, /action=\{runFleetAlertsAction\}/u);
assert.match(types, /payment_due_on: string \| null/u);
assert.match(functionText(actions, "actions.ts", "saveFleetInsurancePolicyAction"), /payment_due_on: dateValue\(formData, "payment_due_on"\)/u);
assert.match(functionText(sections, "fleet-detail-sections.tsx", "PolicyForm", ts.ScriptKind.TSX), /name="payment_due_on"/u);

assert.equal(vercelConfig.$schema, "https://openapi.vercel.sh/vercel.json");
assert.deepEqual(vercelConfig.crons, [{ path: "/api/cron/fleet-alerts", schedule: "0 12 * * *" }]);

console.log("[fleet-alerts-static] PASS idempotent=source-key thresholds=configurable mileage-window=500 cron=daily-protected settings=operable");
