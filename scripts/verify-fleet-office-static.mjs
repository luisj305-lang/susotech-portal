import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const listPage = read("../app/camiones/page.tsx");
const detailPage = read("../app/camiones/[id]/page.tsx");
const actions = read("../src/lib/fleet/actions.ts");
const queries = read("../src/lib/fleet/queries.ts");
const sections = read("../src/components/fleet/fleet-detail-sections.tsx");
const actionForm = read("../src/components/fleet/fleet-action-form.tsx");
const uploader = read("../src/components/fleet/fleet-document-uploader.tsx");
const sidebar = read("../src/components/dashboard/sidebar.tsx");

function sourceFile(source, path, kind = ts.ScriptKind.TS) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}

function exportedAsyncFunctions(source, path) {
  const file = sourceFile(source, path);
  return file.statements.filter((statement) => ts.isFunctionDeclaration(statement)
    && statement.name
    && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
}

function functionText(source, path, name, kind = ts.ScriptKind.TS) {
  const file = sourceFile(source, path, kind);
  const declaration = file.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration?.body, `${path}: missing function ${name}`);
  return declaration.getText(file);
}

function assertOwnOfficeGate(source, path, expectedNames) {
  const file = sourceFile(source, path);
  const functions = exportedAsyncFunctions(source, path);
  assert.deepEqual(functions.map((entry) => entry.name.text), expectedNames, `${path}: exported office function contract changed`);
  for (const declaration of functions) {
    const hasOwnGate = declaration.body?.statements.some((statement) => /await requireSupervisor\(\)/u.test(statement.getText(file)));
    assert.equal(hasOwnGate, true, `${path}: ${declaration.name.text} must establish its own supervisor gate`);
  }
}

assert.match(sidebar, /href: "\/camiones", label: "Camiones"/u);
assert.match(sidebar, /function FleetIcon/u);

for (const page of [listPage, detailPage]) {
  assert.match(page, /await requireSupervisor\(\)/u);
  assert.match(page, /<AppShell/u);
}
assert.match(listPage, /await searchParams/u);
assert.match(listPage, /listFleetVehicles/u);
assert.match(listPage, /createFleetVehicleAction/u);
assert.match(detailPage, /const \{ id \} = await params/u);
assert.match(detailPage, /getFleetVehicleDetail/u);
assert.match(detailPage, /FleetDetailSections/u);

const tabContracts = [
  { value: "resumen", label: "Resumen", section: "SummarySection", wiring: ["updateFleetVehicleAction", "saveFleetOdometerAction", "deleteFleetVehicleAction"] },
  { value: "conductores", label: "Conductores", section: "DriversSection", wiring: ["saveFleetAssignmentAction", "endFleetAssignmentAction", "deleteFleetAssignmentAction"] },
  { value: "seguro", label: "Seguro", section: "InsuranceSection", helpers: ["PolicyForm", "DeleteRecordForm"], wiring: ["saveFleetInsurancePolicyAction", "saveFleetInsurancePaymentAction", "deleteFleetRecordAction"] },
  { value: "mantenimiento", label: "Mantenimiento", section: "MaintenanceSection", helpers: ["MaintenanceForm", "DeleteRecordForm"], wiring: ["saveFleetMaintenanceAction", "deleteFleetRecordAction"] },
  { value: "gastos", label: "Gastos", section: "ExpensesSection", helpers: ["ExpenseForm", "DeleteRecordForm"], wiring: ["saveFleetExpenseAction", "deleteFleetRecordAction", "detail.ledger"] },
  { value: "documentos", label: "Documentos", section: "DocumentsSection", wiring: ["FleetDocumentUploader", "saveFleetDocumentMetadataAction", "deleteFleetDocumentAction"] },
  { value: "incidencias", label: "Incidencias", section: "IncidentsSection", helpers: ["IncidentForm", "DeleteRecordForm"], wiring: ["saveFleetIncidentAction", "deleteFleetRecordAction"] },
];
const detailSectionsBody = functionText(sections, "fleet-detail-sections.tsx", "FleetDetailSections", ts.ScriptKind.TSX);
for (const tab of tabContracts) {
  assert.match(sections, new RegExp(`value: "${tab.value}", label: "${tab.label}"`, "u"));
  assert.match(detailSectionsBody, new RegExp(`activeTab === "${tab.value}"[\\s\\S]*<${tab.section} detail=\\{detail\\}`, "u"));
  const sectionImplementation = functionText(sections, "fleet-detail-sections.tsx", tab.section, ts.ScriptKind.TSX);
  for (const helper of tab.helpers ?? []) assert.match(sectionImplementation, new RegExp(helper, "u"), `${tab.label}: ${tab.section} must invoke ${helper}`);
  const implementation = [sectionImplementation, ...(tab.helpers ?? []).map((name) => functionText(sections, "fleet-detail-sections.tsx", name, ts.ScriptKind.TSX))]
    .join("\n");
  for (const symbol of tab.wiring) assert.match(implementation, new RegExp(symbol.replace(".", "\\."), "u"), `${tab.label}: missing functional wiring for ${symbol}`);
}

assert.match(actions, /^"use server";/u);
const actionNames = [
  "createFleetVehicleAction",
  "updateFleetVehicleAction",
  "deleteFleetVehicleAction",
  "saveFleetAssignmentAction",
  "endFleetAssignmentAction",
  "deleteFleetAssignmentAction",
  "saveFleetInsurancePolicyAction",
  "saveFleetInsurancePaymentAction",
  "saveFleetMaintenanceAction",
  "saveFleetExpenseAction",
  "saveFleetIncidentAction",
  "saveFleetOdometerAction",
  "deleteFleetRecordAction",
  "prepareFleetDocumentUpload",
  "confirmFleetDocumentUpload",
  "saveFleetDocumentMetadataAction",
  "deleteFleetDocumentAction",
];
assertOwnOfficeGate(actions, "actions.ts", actionNames);
for (const action of actionNames) {
  assert.match(actions, new RegExp(`export async function ${action}\\b`, "u"));
}
assert.match(actions, /revalidatePath\("\/camiones"\)/u);
assert.match(actions, /createSignedUploadUrl/u);
assert.match(actions, /fleet-documents/u);
assert.match(actions, /function assertAffectedRow/u);
for (const action of [
  "saveFleetAssignmentAction",
  "endFleetAssignmentAction",
  "deleteFleetAssignmentAction",
  "saveFleetInsurancePolicyAction",
  "saveFleetMaintenanceAction",
  "saveFleetExpenseAction",
  "saveFleetIncidentAction",
  "saveFleetOdometerAction",
  "saveFleetDocumentMetadataAction",
  "deleteFleetDocumentAction",
]) {
  const implementation = functionText(actions, "actions.ts", action);
  assert.match(implementation, /\.eq\("vehicle_id", vehicleId\)/u, `${action}: mutation must bind vehicle_id`);
  assert.match(implementation, /assertAffectedRow/u, `${action}: mutation must reject zero affected rows`);
}
assert.match(functionText(actions, "actions.ts", "saveFleetInsurancePaymentAction"), /requireInsurancePolicyForVehicle/u);
assert.match(functionText(actions, "actions.ts", "deleteFleetRecordAction"), /\.eq\("vehicle_id", vehicleId\)/u);
assert.match(functionText(actions, "actions.ts", "deleteFleetRecordAction"), /requireInsurancePolicyForVehicle/u);
assert.match(functionText(actions, "actions.ts", "syncVehicleOdometer"), /readError/u);
assert.match(functionText(actions, "actions.ts", "syncVehicleOdometer"), /assertAffectedRow/u);

assert.match(queries, /import "server-only"/u);
assertOwnOfficeGate(queries, "queries.ts", ["listFleetVehicles", "getFleetVehicleDetail"]);
assert.match(queries, /export async function listFleetVehicles/u);
assert.match(queries, /export async function getFleetVehicleDetail/u);
assert.match(queries, /rpc\("list_fleet_cost_ledger"/u);
assert.match(queries, /createSignedUrl/u);
assert.match(queries, /profile\.role === "tecnico"/u);

assert.match(actionForm, /^"use client";/u);
assert.match(actionForm, /useActionState/u);
assert.match(actionForm, /router\.refresh\(\)/u);
assert.match(uploader, /^"use client";/u);
assert.match(uploader, /uploadToSignedUrl/u);
assert.match(uploader, /prepareFleetDocumentUpload/u);
assert.match(uploader, /confirmFleetDocumentUpload/u);
assert.match(uploader, /try \{/u);
assert.match(uploader, /catch \(error\)/u);
assert.match(uploader, /finally \{/u);

console.log("[fleet-office-static] PASS routes=2 tabs=7 actions=17 signed-storage=enabled office-gates=present");
