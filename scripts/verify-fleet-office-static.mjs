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

function assertOwnOfficeGate(source, path, expectedNames, gate = /await requireSupervisor\(\)/u) {
  const file = sourceFile(source, path);
  const functions = exportedAsyncFunctions(source, path);
  assert.deepEqual(functions.map((entry) => entry.name.text), expectedNames, `${path}: exported office function contract changed`);
  for (const declaration of functions) {
    const hasOwnGate = declaration.body?.statements.some((statement) => gate.test(statement.getText(file)));
    assert.equal(hasOwnGate, true, `${path}: ${declaration.name.text} must establish its own office gate`);
  }
}

assert.match(sidebar, /href: "\/camiones", label: "Camiones"/u);
const fleetIcon = functionText(sidebar, "sidebar.tsx", "FleetIcon", ts.ScriptKind.TSX);
assert.match(fleetIcon, /viewBox="0 0 24 24"/u);
assert.match(fleetIcon, /stroke="currentColor"/u);
assert.match(fleetIcon, /aria-hidden="true"/u);
for (const part of ["service-truck", "wheels", "hydraulic-boom", "worker-bucket", "utility-pole"]) {
  assert.match(fleetIcon, new RegExp(`data-part="${part}"`, "u"), `FleetIcon: missing ${part} geometry`);
}
const wheels = fleetIcon.match(/<g data-part="wheels">([\s\S]*?)<\/g>/u)?.[1] ?? "";
assert.equal([...wheels.matchAll(/<circle\b/gu)].length, 2, "FleetIcon: expected two distinct wheels");
const boomPoints = fleetIcon.match(/<polyline data-part="hydraulic-boom" points="([^"]+)"/u)?.[1].trim().split(/\s+/u) ?? [];
assert.ok(boomPoints.length >= 4, "FleetIcon: hydraulic boom must have articulated segments");
assert.match(fleetIcon, /<path data-part="worker-bucket"/u, "FleetIcon: worker bucket must be an elevated outline");
assert.match(fleetIcon, /<path data-part="utility-pole"/u, "FleetIcon: utility pole must establish working height");

for (const page of [listPage, detailPage]) {
  assert.match(page, /await requireOfficeViewer\(\)/u);
  assert.match(page, /<AppShell/u);
}
assert.match(listPage, /await searchParams/u);
assert.match(listPage, /listFleetVehicles/u);
assert.match(listPage, /listFleetFuelCorrectionCandidates/u);
assert.match(listPage, /FleetShiftFuelEditor/u);
assert.match(listPage, /createFleetVehicleAction/u);
assert.match(listPage, /updateFleetVehicleStatusAction/u);
const fleetListBody = functionText(listPage, "page.tsx", "FleetPage", ts.ScriptKind.TSX);
assert.match(fleetListBody, /Correcciones de gasolina pendientes/u);
assert.match(fleetListBody, /incluso si no tienen camión asociado/u);
assert.match(fleetListBody, /<FleetShiftFuelEditor/u);
assert.match(fleetListBody, /Paginación de correcciones de gasolina/u);
assert.match(fleetListBody, /<details className="group relative">/u, "create vehicle flow must keep a native grouped details disclosure");
const createSummaryMarkup = fleetListBody.match(/<summary[\s\S]*?<\/summary>/u)?.[0] ?? "";
assert.match(createSummaryMarkup, /<span className="group-open:hidden lg:group-open:inline">\+ Nuevo camión<\/span>/u, "closed and desktop disclosure must show the create label");
assert.match(createSummaryMarkup, /<span className="hidden group-open:inline lg:group-open:hidden">Cerrar formulario<\/span>/u, "open mobile disclosure must expose an explicit close label");
for (const toggleClass of [
  "group-open:fixed",
  "group-open:top-4",
  "group-open:right-4",
  "group-open:z-50",
  "lg:group-open:static",
  "lg:group-open:z-auto",
]) {
  assert.ok(createSummaryMarkup.includes(toggleClass), `open create toggle must include ${toggleClass}`);
}
assert.match(listPage, /const fieldClass = "[^"]*\bw-full\b[^"]*\bmin-w-0\b/u, "fleet fields must shrink within their responsive grid columns");
const createPanelClass = fleetListBody.match(/<\/summary><div className="([^"]+)"/u)?.[1] ?? "";
for (const responsiveClass of [
  "fixed",
  "inset-x-4",
  "top-20",
  "bottom-24",
  "z-40",
  "overflow-x-hidden",
  "overflow-y-auto",
  "touch-pan-y",
  "overscroll-contain",
  "lg:absolute",
  "lg:left-auto",
  "lg:right-0",
  "lg:top-full",
  "lg:bottom-auto",
  "lg:max-h-[calc(100dvh-8rem)]",
  "lg:w-[min(44rem,calc(100vw-3rem))]",
]) {
  assert.ok(createPanelClass.split(/\s+/u).includes(responsiveClass), `create vehicle panel must include ${responsiveClass}`);
}
assert.ok(createPanelClass.includes("top-20"), "mobile create panel must reserve the top viewport band for its close toggle");
assert.doesNotMatch(createPanelClass, /(?:^|\s)absolute(?:\s|$)/u, "create vehicle panel must be viewport-fixed below desktop");
assert.match(fleetListBody, /action=\{createFleetVehicleAction\}[\s\S]*?className="grid gap-3 sm:grid-cols-2"/u, "create form must be one column on mobile and two columns from sm");
assert.match(listPage, /function DraftVehicleActivationControl/u);
assert.match(listPage, /vehicle\.status !== "draft"/u);
assert.match(listPage, /Asigne un conductor principal vigente antes de activar este camión\./u);
assert.match(listPage, /action=\{updateFleetVehicleStatusAction\}/u);
assert.match(listPage, /name="status" value="active"/u);
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
  "updateFleetVehicleStatusAction",
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
  "saveFleetEngineHoursAction",
  "deleteFleetRecordAction",
  "prepareFleetDocumentUpload",
  "confirmFleetDocumentUpload",
  "saveFleetDocumentMetadataAction",
  "deleteFleetDocumentAction",
  "setFleetShiftVehicleAction",
  "setTechnicianShiftFuel",
  "saveFleetSettingsAction",
  "runFleetAlertsAction",
];
assertOwnOfficeGate(actions, "actions.ts", actionNames);
for (const action of actionNames) {
  assert.match(actions, new RegExp(`export async function ${action}\\b`, "u"));
}
assert.match(actions, /revalidatePath\("\/camiones"\)/u);
assert.match(actions, /createSignedUploadUrl/u);
assert.match(actions, /fleet-documents/u);
assert.match(actions, /function assertAffectedRow/u);
const vehicleStatusAction = functionText(actions, "actions.ts", "updateFleetVehicleStatusAction");
assert.match(vehicleStatusAction, /await requireSupervisor\(\)/u);
assert.match(vehicleStatusAction, /enumValue\(formData, "status", FLEET_VEHICLE_STATUSES\)/u);
assert.match(vehicleStatusAction, /\.update\(\{[\s\S]*?status,/u);
assert.match(vehicleStatusAction, /revalidateFleet\(id\)/u);
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
assertOwnOfficeGate(queries, "queries.ts", ["listFleetVehicles", "listFleetFuelCorrectionCandidates", "getFleetVehicleDetail", "getFleetSettings"], /await requireOfficeViewer\(\)/u);
assert.match(queries, /export async function listFleetVehicles/u);
assert.match(queries, /export async function listFleetFuelCorrectionCandidates/u);
assert.match(queries, /export async function getFleetVehicleDetail/u);
assert.match(queries, /rpc\("list_fleet_cost_ledger"/u);
assert.match(queries, /createSignedUrl/u);
assert.match(queries, /profile\.role === "tecnico"/u);
const fuelCorrectionsQuery = functionText(queries, "queries.ts", "listFleetFuelCorrectionCandidates");
assert.match(fuelCorrectionsQuery, /await requireOfficeViewer\(\)/u);
assert.match(fuelCorrectionsQuery, /\.gt\("fuel_amount", 200\)/u);
assert.match(fuelCorrectionsQuery, /\.range\(offset, offset \+ FLEET_FUEL_CORRECTION_PAGE_SIZE - 1\)/u);
assert.match(fuelCorrectionsQuery, /\.in\("id", technicianIds\)/u);
assert.match(fuelCorrectionsQuery, /\.in\("id", vehicleIds\)/u);
const vehicleDetailQuery = functionText(queries, "queries.ts", "getFleetVehicleDetail");
assert.match(vehicleDetailQuery, /\.eq\("vehicle_id", vehicleId\)\.order\("started_at"/u, "fleet detail shifts must stay scoped to the current vehicle");

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

assert.match(sections, /ShiftAssociationsCard/u);
assert.match(sections, /setFleetShiftVehicleAction/u);
assert.match(sections, /VehicleStatusControl/u);
assert.match(sections, /updateFleetVehicleStatusAction/u);
assert.match(functionText(sections, "fleet-detail-sections.tsx", "VehicleStatusControl", ts.ScriptKind.TSX), /FLEET_VEHICLE_STATUSES/u);

console.log("[fleet-office-static] PASS routes=2 tabs=7 actions=23 vehicle-status=activation+all-lifecycle-states fuel-corrections=paged vehicle-shifts=scoped signed-storage=enabled office-gates=present");
