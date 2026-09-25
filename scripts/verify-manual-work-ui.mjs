import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { workListLoader, workListNodes, workListText, workListUiStubs } from "./work-list-test-harness.mjs";

const require = createRequire(import.meta.url);
const { WorkJobCards } = workListLoader(workListUiStubs)("src/components/jobs/job-list.tsx");

function compileFunctions(path, names, variables = []) {
  const filename = new URL(`../${path}`, import.meta.url);
  const source = ts.createSourceFile(filename.pathname, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements = source.statements.filter((node) => (
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""))
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => variables.includes(declaration.name.getText(source))))
  ));
  assert.equal(statements.length, names.length + variables.length, `${path} contains the required runtime symbols`);
  const javascript = ts.transpileModule(statements.map((node) => node.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = vm.createContext({
    exports: {},
    require(name) {
      assert.equal(name, "react/jsx-runtime", "Harness must not invoke application imports");
      return require(name);
    },
    Link: "Link",
    LogoutButton: "LogoutButton",
    WorkerOperationsTable: "WorkerOperationsTable",
    HourlyShiftPanel: "HourlyShiftPanel",
    WorkJobCards,
    WORKER_SPECIALTY_LABELS: { ayudante: "Ayudante" },
  });
  vm.runInContext(javascript, context);
  return context.exports;
}

const manual = compileFunctions("src/components/manual-jobs/manual-jobs-manager.tsx", ["manualWorkersForViewer"]);
const jobs = {
  created_by: "creator",
  workers: [
    { technicianId: "helper", name: "Hourly helper", percentageBasisPoints: 2500, allocatedCents: 1250 },
    { technicianId: "other", name: "Other worker", percentageBasisPoints: 7500, allocatedCents: 3750 },
  ],
};
assert.deepEqual(JSON.parse(JSON.stringify(manual.manualWorkersForViewer(jobs, "helper", true))).map((worker) => worker.technicianId), ["helper"], "Manual participant UI exposes only the helper's own split");
assert.deepEqual(JSON.parse(JSON.stringify(manual.manualWorkersForViewer(jobs, "creator", true))).map((worker) => worker.technicianId).sort(), ["helper", "other"], "Manual creator UI retains the complete split");
assert.deepEqual(JSON.parse(JSON.stringify(manual.manualWorkersForViewer(jobs, "office", false))).map((worker) => worker.technicianId).sort(), ["helper", "other"], "Office UI retains the complete split");

const dashboard = compileFunctions("src/components/dashboard-client.tsx", ["DashboardClient"], ["roleLabels"]);
const dashboardTree = dashboard.DashboardClient({
  profile: { id: "helper", role: "tecnico", email: "helper@example.test", full_name: "Hourly helper", worker_specialty: "ayudante" },
  weeklyProduction: [{ week_start: "2026-03-06", week_end: "2026-03-12" }],
  weeklyFinancial: [{ billing_state: "confirmed", allocated_cents: 1000, allocation_date: "2026-03-06", delivery_id: "delivery", job_id: "job", prism_number: "REGULAR", percentage_basis_points: 10000 }],
  weeklyManualEarnings: [{ week_start: "2026-03-06", week_end_exclusive: "2026-03-13", approval_date: "2026-03-06", manual_job_id: "manual-approved", prism_number: "MANUAL", source_amount_cents: 101, percentage_basis_points: 3333, allocated_cents: 34, review_status: "approved" }],
  manualJobs: [
    { id: "manual-pending", prism_number: "PENDING", value_cents: 10000, status: "pending", created_by: "creator", created_at: "2026-03-07", workers: [{ technicianId: "helper", name: "Hourly helper", percentageBasisPoints: 2500, allocatedCents: 2500 }] },
    { id: "manual-rejected", prism_number: "REJECTED", value_cents: 10000, status: "rejected", created_by: "creator", created_at: "2026-03-08", workers: [{ technicianId: "helper", name: "Hourly helper", percentageBasisPoints: 2500, allocatedCents: 2500 }] },
  ],
});
const dashboardText = workListText(dashboardTree);
assert.match(dashboardText, /Entregas confirmadas/, "Dashboard keeps delivery earnings distinct");
assert.match(dashboardText, /Trabajo manual aprobado/, "Dashboard renders approved manual earnings distinctly");
assert.match(dashboardText, /Total aprobado/, "Dashboard total includes approved manual earnings");
assert.match(dashboardText, /PENDING/, "Shared dashboard work list keeps pending records visible");
assert.match(dashboardText, /REJECTED/, "Shared dashboard work list keeps rejected records visible");
assert.match(dashboardText, /Total aprobado: \$10\.34/, "Operational manual rows never add pending or rejected amounts to earnings");
assert.equal(workListNodes(dashboardTree).filter((node) => node.props["data-work-source"] === "manual").length, 2, "Dashboard executes the shared manual cards rather than a separate preview");

const participation = compileFunctions("src/components/technician/job-participation-card.tsx", ["formatPercentage", "JobParticipationCard"]);
const participationText = JSON.stringify(participation.JobParticipationCard({ informationalBasisPoints: 2500 }));
assert.match(participationText, /25.00%/, "Hourly helper UI renders its submitted percentage as participation");
assert.match(participationText, /jornadas y la nómina/, "Hourly helper UI identifies payroll and shifts as the compensation source");
assert.match(participationText, /no es una asignación financiera/, "Hourly helper UI does not present the percentage as job money");

const weeklyExport = compileFunctions("app/api/produccion/semanal/exportar/route.ts", ["escapeCsvCell", "buildWeeklyProductionCsv"]);
const csv = weeklyExport.buildWeeklyProductionCsv([
  { week_start: "2026-03-06", week_end: "2026-03-12", job_id: "job", delivery_id: "delivery", prism_number: "REGULAR", source_amount_cents: 1000, participant_name: "Percentage helper", worker_specialty: "tecnico", percentage_basis_points: 10000, allocated_cents: 1000, billing_state: "confirmed" },
], [
  { week_start: "2026-03-06", week_end_exclusive: "2026-03-13", approval_date: "2026-03-06", manual_job_id: "manual", prism_number: "MANUAL", source_amount_cents: 101, percentage_basis_points: 3333, allocated_cents: 34, review_status: "approved" },
]);
assert.match(csv, /Origen,PRISM,Fecha/, "Weekly CSV labels the source column");
assert.match(csv, /Entrega regular,REGULAR/, "Weekly CSV preserves regular delivery lines");
assert.match(csv, /Trabajo manual,MANUAL,2026-03-06,1\.01,Mi participación,,33\.33%,0\.34,Aprobado/, "Weekly CSV adds an approved manual item dated by approval without calling it paid");

const newYorkWeek = compileFunctions("src/lib/time/new-york-week.ts", ["getCivilDateParts", "referenceAtForNewYorkWeek", "referenceDateForNewYorkWeek", "currentNewYorkPayrollPeriod", "newYorkDateString"], ["NEW_YORK_TIME_ZONE", "civilDateFormatter"]);
assert.equal(newYorkWeek.referenceDateForNewYorkWeek(-1, new Date("2026-03-13T16:00:00Z")), "2026-03-06", "Spring weekly navigation uses New York civil dates instead of a UTC offset");
assert.equal(newYorkWeek.referenceDateForNewYorkWeek(-1, new Date("2026-11-06T17:00:00Z")), "2026-10-30", "Fall weekly navigation uses New York civil dates instead of a UTC offset");

console.log("PASS manual work UI: participant privacy, all manual statuses, approved total, distinct delivery/manual earnings, and hourly participation messaging");
