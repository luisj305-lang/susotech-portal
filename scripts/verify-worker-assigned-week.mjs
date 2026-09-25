import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { workListLoader } from "./work-list-test-harness.mjs";

// Execute the real component/handlers with deterministic state and JSX, not a
// browser or Supabase SDK. The SQL companion test executes the real RPC in PGlite.
const require = createRequire(import.meta.url);
const workList = workListLoader()("src/lib/jobs/work-list.ts");
const filename = new URL("../src/components/dashboard/worker-activity-table.tsx", import.meta.url);
const source = ts.createSourceFile(filename.pathname, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = source.statements.filter((node) => ts.isFunctionDeclaration(node)
  && ["WorkerActivityTable", "RowGroup"].includes(node.name?.text));
assert.equal(declarations.length, 2);
const javascript = ts.transpileModule(declarations.map((node) => node.getText(source)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const weeks = {
  current: ["2026-09-11T00:00:00-04:00", "2026-09-18T00:00:00-04:00"],
  previous: ["2026-09-04T00:00:00-04:00", "2026-09-11T00:00:00-04:00"],
  empty: ["2026-08-28T00:00:00-04:00", "2026-09-04T00:00:00-04:00"],
};
const history = [
  { id: "current", technicianId: "a", assignedAt: "2026-09-11T04:00:00Z" },
  { id: "previous", technicianId: "a", assignedAt: "2026-09-10T23:00:00-04:00" },
  { id: "other-worker", technicianId: "b", assignedAt: "2026-09-12T12:00:00Z" },
];
const rowsFor = ([start, end]) => ["a", "b"].map((id) => ({
  technician_id: id, technician_name: `Worker ${id}`, week_start_at: start, week_end_exclusive_at: end,
  weekly_production_amount: 0, weekly_production_company_amount: 0, weekly_delivered_jobs: 0,
  weekly_fuel_amount: 0, weekly_allocated_cents: 0, production_breakdown: [], fuel_daily: [],
}));

function harness(presentation, manualJobs = []) {
  const states = [];
  const requests = [];
  let cursor, dirty, tree;
  let rows = rowsFor(weeks.current);
  const context = vm.createContext({
    exports: {},
    ...workList,
    require(name) {
      assert.equal(name, "react/jsx-runtime", "No application/network imports allowed");
      return require(name);
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => {
        const next = typeof value === "function" ? value(states[index]) : value;
        dirty ||= !Object.is(states[index], next);
        states[index] = next;
      }];
    },
    useMemo: (compute) => compute(),
    supabase: { rpc: (name, args) => new Promise((resolve, reject) => requests.push({ name, args, resolve, reject })) },
    inputClass: "", styles: {}, cn: () => "", buttonClasses: () => "",
    formatMoney: String, formatQuantity: String, formatWeekRange: (start, end) => `${start}/${end}`,
    formatShiftStart: String, formatShiftUntil: String,
    fullDateTimeFormatter: { format: (date) => date.toISOString() },
    ...Object.fromEntries(["Card", "CardContent", "CardDescription", "CardHeader", "CardTitle", "StatusBadge",
      "EmptyState", "FilterToggleChip", "IconSearch", "IconUsers", "IconX", "AdminDashboardDialog", "Link", "BreakdownPanel"]
      .map((name) => [name, name])),
  });
  vm.runInContext(javascript, context);
  function render(nextRows = rows) {
    rows = nextRows;
    for (let tries = 0; tries < 10; tries++) {
      dirty = false;
      cursor = 0;
      tree = context.exports.WorkerActivityTable({ rows, manualJobs, presentation });
      if (!dirty) return;
    }
    assert.fail("Render-phase state did not settle");
  }
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap((child) => nodes(child));
    if (!node?.props) return [];
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...nodes(node.props.children)];
  }
  function clickWorker(id, mobile = false) {
    const buttons = nodes(tree).filter((node) => node.type === "button" && node.props.children === `Worker ${id}`);
    assert.equal(buttons.length, 2, "Desktop and mobile worker controls exist");
    return buttons[mobile ? 1 : 0].props.onClick();
  }
  function close() {
    nodes(tree).find((node) => node.props["aria-label"] === "Cerrar").props.onClick();
    render();
  }
  function openJob() {
    nodes(tree).find((node) => node.type === "Link").props.onClick();
    render();
  }
  function finish(index) {
    const request = requests[index];
    const args = request.args;
    const data = history.filter((job) => job.technicianId === args.p_technician_id
      && (!args.p_week_start_at || Date.parse(job.assignedAt) >= Date.parse(args.p_week_start_at))
      && (!args.p_week_end_exclusive_at || Date.parse(job.assignedAt) < Date.parse(args.p_week_end_exclusive_at)));
    request.resolve({ data, error: null });
  }
  const links = () => nodes(tree).filter((node) => node.type === "Link").map((node) => node.props.href);
  const text = () => JSON.stringify(tree);
  render();
  return { render, requests, clickWorker, close, openJob, finish, links, text };
}

for (const presentation of ["default", "admin-dashboard"]) {
  const ui = harness(presentation);
  let pending = ui.clickWorker("a");
  ui.render();
  assert.match(ui.text(), /Cargando/);
  ui.finish(0); await pending; ui.render();
  assert.deepEqual(ui.links(), ["/trabajos/current"], "Current week must not leak history");
  assert.deepEqual(JSON.parse(JSON.stringify(ui.requests[0])), {
    name: "list_technician_assigned_jobs", args: {
      p_technician_id: "a", p_week_start_at: weeks.current[0], p_week_end_exclusive_at: weeks.current[1],
    },
  }, "Forward server timestamps unchanged, without browser date parsing");
  ui.close();
  ui.render(rowsFor(weeks.previous));
  pending = ui.clickWorker("a", true); ui.render();
  ui.finish(1); await pending; ui.render();
  assert.deepEqual(ui.links(), ["/trabajos/previous"], "Previous-week mobile drill-down");
  const jobLink = ui.links()[0];
  assert.equal(jobLink, "/trabajos/previous");
  ui.render(rowsFor(weeks.empty));
  assert.deepEqual(ui.links(), [], "Changing weeks closes an already loaded modal");
  pending = ui.clickWorker("a"); ui.render(); ui.finish(2); await pending; ui.render();
  assert.match(ui.text(), /No tiene trabajos asignados ni manuales registrados en esta semana\./);
  ui.close();
  ui.render(rowsFor(weeks.current));

  const oldWorker = ui.clickWorker("a"); ui.render();
  const newWorker = ui.clickWorker("b"); ui.render();
  ui.finish(4); await newWorker; ui.render();
  ui.finish(3); await oldWorker; ui.render();
  assert.deepEqual(ui.links(), ["/trabajos/other-worker"], "Late worker response cannot overwrite current worker");
  ui.close();
  const oldWeek = ui.clickWorker("a"); ui.render();
  ui.render(rowsFor(weeks.previous));
  assert.deepEqual(ui.links(), []);
  pending = ui.clickWorker("a"); ui.render();
  ui.finish(6); await pending; ui.render();
  ui.requests[5].reject(new Error("stale request")); await oldWeek; ui.render();
  assert.deepEqual(ui.links(), ["/trabajos/previous"], "Late week failure cannot replace current results");
  const closing = ui.clickWorker("a"); ui.render(); ui.close();
  pending = ui.clickWorker("a"); ui.render();
  ui.finish(7); await closing; ui.render();
  assert.match(ui.text(), /Cargando/, "Closed request cannot finish a reopened modal for the same worker/week");
  ui.requests[8].resolve({ data: null, error: { message: "offline test error" } }); await pending; ui.render();
  assert.match(ui.text(), /No se pudieron cargar los trabajos asignados/);
  assert.deepEqual(ui.links(), [], "Failure never falls back to all-history data");
  ui.render([]);
  assert.doesNotMatch(ui.text(), /Trabajos de /, "Worker visibility loss closes the modal");

  const returning = harness(presentation);
  returning.render(rowsFor(weeks.previous));
  pending = returning.clickWorker("a"); returning.finish(0); await pending; returning.render();
  returning.openJob();
  assert.deepEqual(returning.links(), [], "Opening a job closes the modal without changing week props");
  returning.render(rowsFor(weeks.previous));
  pending = returning.clickWorker("a"); returning.finish(1); await pending; returning.render();
  assert.deepEqual(returning.links(), ["/trabajos/previous"], "Returning/reopening retains the selected previous week");
  const first = returning.clickWorker("a"); returning.render();
  const second = returning.clickWorker("b"); returning.render();
  returning.finish(2); await first; returning.render();
  assert.match(returning.text(), /Cargando/, "Old success cannot clear a newer worker's loading state");
  returning.finish(3); await second; returning.render();
  assert.match(returning.text(), /No tiene trabajos asignados ni manuales registrados en esta semana\./);

  const manualJobs = [
    { id: "current", status: "pending", created_at: "2026-09-11T04:00:00Z" },
    { id: "later-approval", status: "approved", created_at: "2026-09-12T12:00:00Z", reviewed_at: "2026-09-20T12:00:00Z" },
    { id: "rejected", status: "rejected", created_at: "2026-09-13T12:00:00Z" },
    { id: "fourth", status: "pending", created_at: "2026-09-14T12:00:00Z" },
    { id: "before", status: "approved", created_at: "2026-09-11T03:59:59.999Z", reviewed_at: "2026-09-12T12:00:00Z" },
    { id: "end", status: "pending", created_at: "2026-09-18T04:00:00Z" },
  ].map((job) => ({ ...job, prism_number: job.id, workers: [{ technicianId: "a" }] }));
  manualJobs.push({ id: "unrelated", prism_number: "unrelated", status: "pending", created_at: "2026-09-12T12:00:00Z", created_by: "a", workers: [{ technicianId: "b" }] });
  const mixed = harness(presentation, manualJobs);
  pending = mixed.clickWorker("a"); mixed.finish(0); await pending; mixed.render();
  assert.deepEqual(mixed.links(), ["/trabajos/current", "/manual#manual-current", "/manual#manual-later-approval", "/manual#manual-rejected", "/manual#manual-fourth"], "Same source ID coexists, all manual states render, and creator-only records are not assignments");
  for (const status of ["Pendiente", "Aprobado", "Rechazado"]) assert.match(mixed.text(), new RegExp(status));
  mixed.render(rowsFor(weeks.previous));
  assert.deepEqual(mixed.links(), [], "Changing week closes both sources together");
  pending = mixed.clickWorker("a", true); mixed.finish(1); await pending; mixed.render();
  assert.deepEqual(mixed.links(), ["/trabajos/previous", "/manual#manual-before"], "Manual membership follows registration, not approval");
}
console.log("PASS worker assigned-week component: mixed sources, native statuses, current/previous/empty weeks, both presentations, desktop/mobile, late requests, errors and participant visibility");
