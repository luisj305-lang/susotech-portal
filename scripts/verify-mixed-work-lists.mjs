import assert from "node:assert/strict";
import { workListLoader, workListNodes as nodes, workListText as text, workListUiStubs } from "./work-list-test-harness.mjs";

const load = workListLoader(workListUiStubs);
const { combineWorkItems, filterManualWork, isInWorkWeek, manualJobsForWorkerWeek } = load("src/lib/jobs/work-list.ts");
const { WorkJobCards, JobList } = load("src/components/jobs/job-list.tsx");
const { PendingReview } = load("src/components/dashboard/pending-review.tsx");
const { DashboardClient } = load("src/components/dashboard-client.tsx");
const referenceAt = new Date("2026-09-16T12:00:00Z");
const regular = { id: "same", prism_number: "REGULAR", main_status: "en_revision", created_at: "2026-08-01T12:00:00Z", assignedAt: "2026-09-11T04:00:00Z", assignment_date: "2020-01-01", updated_at: "2026-09-16T12:00:00Z", submitted_at: "2026-09-16T12:00:00Z", assignee_label: "Worker", delivered_pdf_status: "pending" };
const manual = (id, status, created_at, overrides = {}) => ({ id, prism_number: id.toUpperCase(), status, created_at, created_by: "creator", workers: [{ technicianId: "helper", name: "Helper", percentageBasisPoints: 10000 }], value_cents: 999999, ...overrides });
const manuals = [
  manual("same", "pending", "2026-09-11T04:00:00Z"),
  manual("approved-later", "approved", "2026-09-12T12:00:00Z", { reviewed_at: "2026-09-20T12:00:00Z" }),
  manual("rejected", "rejected", "2026-09-13T12:00:00Z"),
  manual("fourth", "pending", "2026-09-14T12:00:00Z"),
  manual("last-instant", "pending", "2026-09-18T03:59:59.999Z"),
  manual("previous-approved-now", "approved", "2026-09-11T03:59:59.999Z", { reviewed_at: "2026-09-12T12:00:00Z" }),
  manual("next", "pending", "2026-09-18T04:00:00Z"),
];
const ids = (jobs) => Array.from(jobs, (job) => job.id);
const weekly = filterManualWork(manuals, { referenceAt });
assert.deepEqual(ids(weekly), ["same", "approved-later", "rejected", "fourth", "last-instant"]);
assert.deepEqual(ids(filterManualWork(manuals, { referenceAt: new Date("2026-09-23T12:00:00Z") })), ["next"], "Approval never duplicates registration into another week");
assert.deepEqual(ids(filterManualWork(manuals, { referenceAt, tab: "activos" })), ["same", "fourth", "last-instant"]);
assert.deepEqual(ids(filterManualWork(manuals, { referenceAt, tab: "revisados" })), ["approved-later", "rejected"]);
assert.deepEqual(ids(filterManualWork(manuals, { referenceAt, status: "en_revision" })), ["same", "fourth", "last-instant"]);
assert.deepEqual(ids(filterManualWork(manuals, { referenceAt, status: "manual:rejected", query: " ReJeCtEd " })), ["rejected"]);
for (const filters of [{ archived: true }, { facturados: true }, { status: "asignado" }, { status: "pagado" }]) {
  assert.equal(filterManualWork(manuals, filters).length, 0, "Manual work does not fabricate regular lifecycle states");
}
for (const [reference, start, end] of [
  ["2026-03-10T12:00:00Z", "2026-03-06T05:00:00Z", "2026-03-13T04:00:00Z"],
  ["2026-11-03T12:00:00Z", "2026-10-30T04:00:00Z", "2026-11-06T05:00:00Z"],
]) {
  assert.equal(isInWorkWeek(start, new Date(reference)), true);
  assert.equal(isInWorkWeek(new Date(Date.parse(start) - 1).toISOString(), new Date(reference)), false);
  assert.equal(isInWorkWeek(new Date(Date.parse(end) - 1).toISOString(), new Date(reference)), true);
  assert.equal(isInWorkWeek(end, new Date(reference)), false);
}
assert.equal(isInWorkWeek(null, referenceAt), false, "No fallback to editable assignment_date");
const entries = combineWorkItems([regular], weekly);
assert.deepEqual(Array.from(entries, (entry) => entry.key), ["regular:same", ...weekly.map((job) => `manual:${job.id}`)]);
assert.equal(new Set(entries.map((entry) => entry.key)).size, 6, "Same UUID in different sources cannot collide");
const links = (tree) => nodes(tree).filter((node) => node.type === "Link").map((node) => node.props.href);
const cards = WorkJobCards({ jobs: [regular], manualJobs: weekly });
assert.deepEqual(links(cards), ["/trabajos/same", ...weekly.map((job) => `/manual#manual-${job.id}`)]);
assert.equal(nodes(cards).filter((node) => node.props["data-work-source"] === "manual").length, 5, "All manual entries render, not just three");
assert.match(text(cards), /Manual · Pendiente/);
assert.match(text(cards), /Manual · Aprobado/);
assert.match(text(cards), /Manual · Rechazado/);
assert.doesNotMatch(text(cards), /9999|Helper/, "Operational cards do not expose roster/financial data");
const list = JobList({ jobs: [regular], manualJobs: weekly, weekOffset: -1 });
assert.ok(links(list).includes("/dashboard?week=-1"));
assert.ok(links(list).some((href) => href.includes("tab=revisados") && href.includes("week=-1")));
assert.equal(nodes(list).filter((node) => node.type === "input" && node.props.name === "week").length, 2);
for (const presentation of ["default", "admin-dashboard"]) {
  const pending = PendingReview({ jobs: [regular], manualJobs: weekly, presentation, weekOffset: -1 });
  assert.ok(links(pending).includes("/trabajos/same"));
  assert.ok(links(pending).includes("/manual#manual-same"));
  assert.ok(links(pending).includes("/trabajos?status=en_revision&week=-1"));
  assert.ok(!links(pending).includes("/manual#manual-rejected"));
  const many = PendingReview({ jobs: [regular], manualJobs: Array.from({ length: 12 }, (_, i) => manual(`pending-${i}`, "pending", "2026-09-17T12:00:00Z")), presentation });
  assert.equal(links(many).filter((href) => href.startsWith("/manual#")).length, 8, "Existing eight-entry review cap applies to the combined queue");
}
assert.deepEqual(ids(manualJobsForWorkerWeek(manuals, "helper", "2026-09-11T04:00:00Z", "2026-09-18T04:00:00Z")), ids(weekly));
assert.equal(manualJobsForWorkerWeek(manuals, "unrelated", "2026-09-11T04:00:00Z", "2026-09-18T04:00:00Z").length, 0);
const profile = { id: "helper", role: "tecnico", email: "helper@example.test", full_name: "Helper" };
const financial = {
  weeklyFinancial: [{ billing_state: "confirmed", allocated_cents: 1000 }, { billing_state: "pending", allocated_cents: 200 }],
  weeklyManualEarnings: [{ manual_job_id: "approved-another-week", allocated_cents: 34, percentage_basis_points: 3333, approval_date: "2026-09-16" }],
};
const dashboard = DashboardClient({ profile, jobs: [regular], manualJobs: weekly, ...financial });
const earnings = (tree) => nodes(tree).filter((node) => node.type === "p" && /^(Entregas confirmadas|Trabajo manual aprobado:|Total aprobado:|Pendiente:)/.test(text(node))).map(text);
assert.deepEqual(earnings(dashboard), earnings(DashboardClient({ profile, ...financial })), "Operational manual rows cannot add money again");
assert.ok(earnings(dashboard).includes("Total aprobado: $10.34"));
assert.equal(links(dashboard).filter((href) => href.startsWith("/manual#")).length, 5);

const adminLoad = workListLoader({
  ...workListUiStubs,
  "./app-shell": { AppShell: "AppShell" },
  "@/components/ui/page-header": { PageHeader: "PageHeader" },
  "./stat-cards": { StatCards: "StatCards" },
  "./worker-activity-table": { WorkerActivityTable: "WorkerActivityTable" },
  "./quick-actions": { QuickActions: "QuickActions" },
  "@/lib/dashboard/format": { formatWeekRange: () => "Selected week" },
});
for (const role of ["admin", "supervisor"]) {
  const rows = [{ technician_id: "helper", weekly_allocated_cents: 1234 }];
  const tree = adminLoad("src/components/dashboard/admin-dashboard.tsx").AdminDashboard({
    profile: { ...profile, role }, workerOperations: rows, pendingReview: [regular], manualJobs: weekly,
    weeklyInvoiced: { invoiced_cents: 4321, delivered_jobs: 1 }, weekOffset: -1,
  });
  const workerTable = nodes(tree).find((node) => node.type === "WorkerActivityTable");
  assert.equal(workerTable.props.manualJobs, weekly, "Both office presentations receive the manual operational list");
  assert.equal(workerTable.props.rows, rows, "Worker monetary rows are not recomputed from operational work");
  assert.equal(nodes(tree).find((node) => node.type === "StatCards").props.invoicedCents, 4321);
  assert.ok(links(tree).includes("/manual#manual-same"));
}

let rpcError = null;
const rpcCalls = [];
const queryLoad = workListLoader({
  "@/lib/supabase/server": { createClient: async () => ({ rpc: async (name) => {
    rpcCalls.push(name);
    return { data: [{ ...manuals[0], value_cents: "100", workers: [{ technicianId: "helper", percentageBasisPoints: "2500", allocatedCents: "25" }] }], error: rpcError };
  } }) },
});
const queries = queryLoad("src/lib/manual-jobs/queries.ts");
for (const [method, rpc] of [["getMyManualJobs", "list_manual_jobs_v2"], ["getOfficeManualJobs", "list_manual_jobs_v2"]]) {
  const result = await queries[method]();
  assert.equal(rpcCalls.at(-1), rpc);
  assert.equal(result[0].workers[0].allocatedCents, 25);
  assert.deepEqual(Array.from(result[0].workers, (worker) => worker.technicianId), ["helper"], "Normalization never widens the scoped roster");
  rpcError = { message: "Denied" };
  await assert.rejects(() => queries[method](), /No se pudieron cargar/);
  rpcError = null;
}

// Execute both real route functions with authorized read boundaries mocked;
// SQL companion tests exercise the actual RPC permissions, not this fixture.
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [referenceAt])); }
  static now() { return referenceAt.getTime(); }
}
let role = "tecnico", active = true;
const calls = [];
const officeRow = { technician_id: "helper", week_start_at: "2026-09-11T04:00:00Z", week_end_exclusive_at: "2026-09-18T04:00:00Z" };
const routeLoad = workListLoader({
  ...workListUiStubs,
  "@/lib/auth/session": { requireProfile: async () => ({ ...profile, role }) },
  "@/lib/dashboard/profile": { displayName: () => "Helper", initials: () => "H", roleLabel: () => role },
  "@/lib/work-shifts/access": { requireActiveShiftPage: async () => {}, getWorkShiftAccess: async () => ({ active }) },
  "@/lib/jobs/queries": {
    listTechnicianQueueJobs: async (args) => { calls.push(["regular-technician", args]); return [regular, { ...regular, id: "old-regular", assignedAt: "2026-09-10T12:00:00Z", assignment_date: "2026-09-12" }]; },
    listOfficeJobs: async (args) => { calls.push(["regular-office", args]); return [regular]; },
    getMyWeeklyFinancialAllocations: async () => financial.weeklyFinancial,
    getMyWeeklyProduction: async () => [],
    getWorkerOperationsDashboard: async () => [officeRow],
    getWeeklyInvoicedTotal: async () => ({ invoiced_cents: 4321, delivered_jobs: 1 }),
  },
  "@/lib/manual-jobs/queries": {
    getMyManualJobs: async () => { calls.push(["manual-technician"]); return manuals; },
    getOfficeManualJobs: async () => { calls.push(["manual-office"]); return manuals; },
    getMyWeeklyManualEarnings: async () => financial.weeklyManualEarnings,
  },
  "@/components/dashboard/admin-dashboard": { AdminDashboard: "AdminDashboard" },
  "@/components/dashboard/app-shell": { AppShell: "AppShell" },
  "@/components/dashboard/field-shell": { FieldShell: "FieldShell" },
  "@/components/jobs/archived-job-delete-button": { ArchivedJobDeleteButton: "DeleteButton", RetryJobDeletionCleanupButton: "RetryButton" },
  "@/components/work-shifts/shift-start-prompt": { ShiftStartPrompt: "ShiftStartPrompt" },
  "@/lib/work-shifts/queries": { getMyHourlyPayrollSummary: async () => null },
  "@/lib/fleet/technician-queries": { getMyPrimaryVehicleLabel: async () => null },
}, { Date: FixedDate });
const JobsPage = routeLoad("app/trabajos/page.tsx").default;
const DashboardPage = routeLoad("app/dashboard/page.tsx").default;
for (role of ["tecnico", "admin", "supervisor"]) {
  calls.length = 0;
  const page = await JobsPage({ searchParams: Promise.resolve({ week: "0" }) });
  const urls = links(page);
  assert.ok(urls.includes("/trabajos/same"));
  assert.ok(urls.includes("/manual#manual-same"));
  assert.ok(!urls.includes("/trabajos/old-regular"));
  assert.ok(!urls.includes("/manual#manual-previous-approved-now"));
  assert.ok(calls.some(([name]) => name === (role === "tecnico" ? "manual-technician" : "manual-office")));
  assert.ok(!calls.some(([name]) => name === (role === "tecnico" ? "manual-office" : "manual-technician")), "Role cannot cross to the other manual read source");
  const manualOnly = await JobsPage({ searchParams: Promise.resolve({ week: "0", tab: "revisados", status: "manual:rejected" }) });
  assert.deepEqual(links(manualOnly).filter((href) => href.startsWith("/manual#") || /^\/trabajos\/same$/.test(href)), ["/manual#manual-rejected"]);
  const home = await DashboardPage({ searchParams: Promise.resolve({ week: "0" }) });
  if (role === "tecnico") {
    assert.equal(links(home).filter((href) => href.startsWith("/manual#")).length, 5);
    assert.ok(!links(home).includes("/trabajos/old-regular"));
  } else {
    assert.deepEqual(ids(home.props.manualJobs), ids(weekly));
    assert.equal(home.props.weeklyInvoiced.invoiced_cents, 4321);
    assert.equal(home.props.workerOperations[0], officeRow);
  }
}
role = "tecnico"; active = false; calls.length = 0;
const inactiveHome = await DashboardPage({ searchParams: Promise.resolve({ week: "0" }) });
assert.ok(!calls.some(([name]) => name === "regular-technician"), "No active-shift bypass for regular jobs");
assert.equal(links(inactiveHome).filter((href) => href.startsWith("/manual#")).length, 5);
console.log("PASS mixed work lists: real cards/routes, source collisions, role boundaries, native filters, >3 manuals, DST and half-open weeks, unchanged earnings");
