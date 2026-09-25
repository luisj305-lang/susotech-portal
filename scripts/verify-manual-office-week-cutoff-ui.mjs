import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { workListLoader, workListNodes as nodes, workListText as text, workListUiStubs } from "./work-list-test-harness.mjs";

const require = createRequire(import.meta.url);
let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(path, stubs) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const exports = {};
  const javascript = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  // Same-realm arrays are required by pdf-lib's instanceof-based validation.
  // Application imports are still explicitly allowlisted and stubbed offline.
  vm.compileFunction(javascript, ["exports", "require", "document"], { filename: path })(exports, (name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(stubs, name), `Offline harness blocks unstubbed import ${name}`);
    return stubs[name];
  }, { getElementById: () => null });
  return exports;
}

const context = { first_financial_week: "2026-03-20", current_financial_week: "2026-03-20", today: "2026-03-26" };
const job = { id: "new", prism_number: "NEW", value_cents: 10000, status: "approved", created_by: "office",
  created_at: "2026-03-26T18:00:00Z", reviewed_at: "2026-03-28T18:00:00Z", financial_week_start: "2026-04-03",
  description: "New field work", work_date: "2026-03-19", revision: 1,
  workers: [{ technicianId: "worker", name: "Worker", percentageBasisPoints: 10000 }] };
const legacy = { ...job, id: "old", prism_number: "LEGACY", revision: null, financial_week_start: null, work_date: null, description: null };

function manager(role, updateResult = { success: true, message: "Updated" }, jobs = [job, legacy]) {
  const state = [], pending = [], calls = [];
  let cursor = 0;
  const component = load("src/components/manual-jobs/manual-jobs-manager.tsx", {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
      },
      useEffect: () => {},
      useTransition: () => [false, (fn) => { pending.push(fn()); }],
    },
    "next/navigation": { useRouter: () => ({ refresh: () => calls.push(["refresh"]) }) },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/icons": { IconClipboardCheck: "Icon" },
    "@/components/ui/empty-state": { EmptyState: "EmptyState" },
    "@/lib/supabase/client": { supabase: { rpc: async () => ({ data: [], error: null }) } },
    "@/lib/dashboard/format": { formatMoney: (value) => `$${value.toFixed(2)}` },
    "@/lib/manual-jobs/actions": {
      createManualJob: async (input) => { calls.push(["create", plain(input)]); return { success: true, message: "Created" }; },
      updateManualJob: async (input) => { calls.push(["update", plain(input)]); return updateResult; },
      reviewManualJob: async (input) => { calls.push(["review", plain(input)]); return { success: true, message: "Reviewed" }; },
      createManualJobPdfUrl: async () => ({ success: false, message: "Unavailable" }),
    },
  });
  return {
    calls,
    render() { cursor = 0; return component.ManualJobsManager({ role, currentUserId: "worker", initialJobs: jobs, creationContext: context }); },
    async flush() { await Promise.all(pending.splice(0)); },
  };
}
function field(tree, label) {
  const match = nodes(tree).find((node) => node.type === "label" && text(node).includes(label));
  assert.ok(match, `Rendered label ${label}`);
  return nodes(match).find((node) => ["input", "textarea", "select"].includes(node.type));
}
function button(tree, label) {
  const match = nodes(tree).find((node) => node.type === "Button" && text(node) === label);
  assert.ok(match, `Rendered button ${label}`);
  return match;
}

for (const role of ["admin", "supervisor", "tecnico"]) {
  const ui = manager(role);
  let tree = ui.render();
  field(tree, "Número de PRISM").props.onChange({ target: { value: "PRISM-TEST" } });
  field(tree, "Valor total").props.onChange({ target: { value: "100" } });
  field(tree, "Descripción del trabajo").props.onChange({ target: { value: "Completed work" } });
  field(tree, "Fecha en que se realizó").props.onChange({ target: { value: "2026-03-19" } });
  if (role !== "tecnico") {
    equal(field(tree, "Semana financiera").props.min, "2026-03-20", "Office picker uses the server activation boundary");
    field(tree, "Semana financiera").props.onChange({ target: { value: "2026-04-03" } });
  } else {
    equal(nodes(tree).some((n) => n.type === "label" && text(n).includes("Semana financiera")), false, "Technician cannot select a week");
  }
  nodes(tree).find((n) => n.type === "select").props.onChange({ target: { value: "worker" } });
  field(tree, "Porcentaje").props.onChange({ target: { value: "100" } });
  tree = ui.render();
  button(tree, "Enviar trabajo manual").props.onClick();
  await ui.flush();
  const input = ui.calls.find((call) => call[0] === "create")[1];
  equal(input.description, "Completed work", `${role} submits description`);
  equal(input.workDate, "2026-03-19", `${role} submits independent work date`);
  equal(input.financialWeek, role === "tecnico" ? undefined : "2026-04-03", `${role} submits correct selected/default week intent`);
}
const auditorTree = manager("auditor").render();
equal(nodes(auditorTree).some((n) => n.type === "textarea" || n.type === "input"), false, "Auditor has no creation/editor controls");
const correctedTree = manager("admin", undefined, [{ ...job, revision: 2, pdf_path: null }]).render();
equal(text(correctedTree).includes("el comprobante anterior quedó invalidado"), true, "Edited record shows explicit receipt invalidation");
equal(nodes(correctedTree).some((n) => n.type === "Button" && text(n) === "Ver PDF"), false, "No current PDF control is offered for an invalidated receipt");
for (const role of ["admin", "supervisor", "tecnico", "auditor"]) {
  const ui = manager(role);
  const edits = nodes(ui.render()).filter((n) => n.type === "Button" && text(n) === "Editar trabajo");
  equal(edits.length, role === "admin" || role === "supervisor" ? 1 : 0, "Editor is office-only and never offered for legacy records");
  if (!edits.length) continue;
  edits[0].props.onClick();
  let tree = ui.render();
  equal(field(tree, "Descripción del trabajo").props.value, job.description, "Editor hydrates the persisted description");
  equal(field(tree, "Semana financiera").props.value, job.financial_week_start, "Editor hydrates financial week independently of work date");
  field(tree, "Valor total").props.onChange({ target: { value: "250" } });
  tree = ui.render();
  button(tree, "Guardar cambios").props.onClick();
  await ui.flush();
  const input = ui.calls.find((call) => call[0] === "update")[1];
  equal([input.id, input.expectedRevision, input.valueCents], [job.id, 1, 25000], "Editor sends ID, loaded revision and integer cents");
  equal(ui.calls.some((call) => call[0] === "create"), false, "Saving an edit cannot create a duplicate job");
  equal(nodes(ui.render()).some((n) => n.type === "Button" && text(n) === "Guardar cambios"), false, "Successful edit exits editing mode");
}
const conflictUi = manager("admin", { success: false, message: "Manual job changed; reload before editing" });
button(conflictUi.render(), "Editar trabajo").props.onClick();
button(conflictUi.render(), "Guardar cambios").props.onClick();
await conflictUi.flush();
equal(text(conflictUi.render()).includes("reload before editing"), true, "Version conflict is visible without discarding the form");
equal(nodes(conflictUi.render()).some((n) => n.type === "Button" && text(n) === "Guardar cambios"), true, "Failed edit retains editing state");
button(conflictUi.render(), "Cancelar edición").props.onClick();
equal(field(conflictUi.render(), "Número de PRISM").props.value, "", "Cancel clears edit state without a mutation");

let actorRole = "admin", rpcError = null, receiptError = null, signedReads = [];
const actionCalls = [], invalidations = [], uploads = [];
const pdf = load("src/lib/manual-jobs/pdf.ts", { "server-only": {}, "pdf-lib": require("pdf-lib") });
await pdf.composeManualJobPdf({ prismNumber: "LOCAL", valueCents: 100, creatorName: "Office", dateLabel: "2026-03-26", workers: [] });
const actions = load("src/lib/manual-jobs/actions.ts", {
  "next/cache": { revalidatePath: (path) => invalidations.push(path) },
  "@/lib/auth/session": {
    requireProfile: async () => ({ id: "actor", role: actorRole, full_name: "Office", email: "office@example.test" }),
    requireSupervisor: async () => { if (!["admin", "supervisor"].includes(actorRole)) throw new Error("Denied"); },
  },
  "@/lib/supabase/server": { createClient: async () => ({
    rpc: async (name, args) => {
      actionCalls.push([name, plain(args)]);
      return { data: name === "create_manual_job_v2" ? "created" : 2, error: name === "set_manual_job_pdf_path_v2" ? receiptError : rpcError };
    },
    from: (table) => ({ select: () => ({
      in: async () => { assert.equal(table, "profiles"); return { data: [{ id: "worker", full_name: "Worker" }], error: null }; },
      eq: () => ({ maybeSingle: async () => { assert.equal(table, "manual_jobs"); return { data: signedReads.shift(), error: null }; } }),
    }) }),
    storage: { from: () => ({ createSignedUrl: async (path, seconds) => {
      equal(seconds, 60, "Receipt link remains short-lived");
      return { data: { signedUrl: `offline:${path}` }, error: null };
    } }) },
  }) },
  "@/lib/supabase/service": { createServiceClient: () => ({ storage: { from: () => ({ upload: async (path, bytes, options) => {
    const document = await require("pdf-lib").PDFDocument.load(bytes);
    equal(document.getPageCount(), 1, "Actual receipt composer produces a valid local PDF");
    uploads.push([path, plain(options)]);
    return { error: null };
  } }) } }) },
  "./pdf": pdf,
});
const actionInput = { prismNumber: "TEST", valueCents: 10000, workers: [{ technicianId: "worker", percentageBasisPoints: 10000 }],
  description: "Work", workDate: "2026-03-19", financialWeek: "2026-04-03" };
for (const role of ["admin", "supervisor", "tecnico"]) {
  actorRole = role;
  const result = await actions.createManualJob({ ...actionInput, financialWeek: role === "tecnico" ? undefined : actionInput.financialWeek });
  equal(result.success, true, `${role} creation action succeeds through scoped RPC`);
  equal(actionCalls.at(-1), ["set_manual_job_pdf_path_v2", { p_manual_job_id: "created", p_expected_revision: 1, p_pdf_path: "manual-jobs/created/revision-1.pdf" }], "Initial receipt attachment is revision-guarded");
  equal(uploads.at(-1), ["manual-jobs/created/revision-1.pdf", { contentType: "application/pdf", upsert: false }], "Receipt upload cannot overwrite another revision");
}
actorRole = "auditor";
const beforeDenied = actionCalls.length;
equal((await actions.createManualJob(actionInput)).success, false, "Server action denies auditor creation before mutation");
equal((await actions.updateManualJob({ ...actionInput, id: "new", expectedRevision: 1 })).success, false, "Server action denies auditor update before mutation");
equal(actionCalls.length, beforeDenied, "Denied server actions never call mutation RPCs");
actorRole = "supervisor";
const uploadCount = uploads.length;
equal((await actions.updateManualJob({ ...actionInput, id: "new", expectedRevision: 1 })).success, true, "Authorized update action succeeds");
equal(actionCalls.at(-1)[0], "update_manual_job", "Update action uses atomic editor RPC");
equal(actionCalls.at(-1)[1].p_expected_revision, 1, "Server forwards the concurrency token");
equal(uploads.length, uploadCount, "Edits do not regenerate or reattach an obsolete receipt");
equal([...new Set(invalidations)].sort(), ["/dashboard", "/manual", "/produccion", "/trabajos"], "Mutations invalidate each affected visible route");
rpcError = { message: "Manual job changed; reload before editing" };
const invalidationCount = invalidations.length;
equal((await actions.updateManualJob({ ...actionInput, id: "new", expectedRevision: 1 })).success, false, "Version conflict returns failure from actual server action");
equal(invalidations.length, invalidationCount, "Failed mutations do not announce successful route invalidation");
rpcError = null;
receiptError = { message: "Manual job changed; receipt is obsolete" };
equal((await actions.createManualJob(actionInput)).message.includes("no se pudo generar su PDF"), true, "Racing creation receipt returns an honest unavailable warning");
signedReads = [{ pdf_path: null, revision: 2 }];
equal((await actions.createManualJobPdfUrl({ id: "new" })).success, false, "Cleared receipt never produces a URL");
signedReads = [{ pdf_path: "initial.pdf", revision: 1 }, { pdf_path: null, revision: 2 }];
equal((await actions.createManualJobPdfUrl({ id: "new" })).success, false, "Edit during URL signing rejects the now-obsolete receipt");
signedReads = [{ pdf_path: "legacy.pdf", revision: null }, { pdf_path: "legacy.pdf", revision: null }];
equal((await actions.createManualJobPdfUrl({ id: "old" })).signedUrl, "offline:legacy.pdf", "Unchanged legacy receipt remains available");

const queryCalls = [];
const queries = load("src/lib/manual-jobs/queries.ts", {
  "server-only": {},
  "@/lib/supabase/server": { createClient: async () => ({ rpc: async (name, args) => {
    queryCalls.push([name, plain(args ?? {})]);
    return { data: name === "get_manual_job_creation_context" ? [context] : [], error: null };
  } }) },
});
await queries.getMyWeeklyManualEarnings("2026-04-03");
equal(queryCalls[0], ["get_my_weekly_manual_earnings_v2", { p_reference_date: "2026-04-03" }], "Manual earnings query uses versioned financial-date read model");
equal(await queries.getManualJobCreationContext(), context, "Creation context comes from server RPC");

const route = load("app/api/produccion/semanal/exportar/route.ts", {
  "@/lib/auth/session": {}, "@/lib/jobs/queries": {}, "@/lib/manual-jobs/queries": {}, "@/lib/time/new-york-week": {},
});
const line = { week_start: "2026-04-03", week_end_exclusive: "2026-04-10", manual_job_id: job.id, prism_number: job.prism_number,
  source_amount_cents: 10000, allocated_cents: 10000, percentage_basis_points: 10000, review_status: "approved",
  financial_date: "2026-04-03", approval_date: "2026-03-28" };
const csv = route.buildWeeklyProductionCsv([], [line]);
equal(csv.includes("Trabajo manual,NEW,2026-04-03,100.00"), true, "CSV dates new manual earnings by financial week, not approval");
const loadWork = workListLoader(workListUiStubs);
const { DashboardClient } = loadWork("src/components/dashboard-client.tsx");
const dashboard = DashboardClient({ profile: { id: "worker", role: "tecnico" }, weeklyManualEarnings: [line] });
equal(text(dashboard).includes("Fecha financiera"), true, "Dashboard financial date has an honest label");
equal(text(dashboard).includes("2026-04-03"), true, "Dashboard and CSV agree on selected financial date");
const { filterManualWork } = loadWork("src/lib/jobs/work-list.ts");
equal(filterManualWork([job], { referenceAt: new Date("2026-03-26T12:00:00Z") }).length, 1, "Operational list still uses registration week");
equal(filterManualWork([job], { referenceAt: new Date("2026-04-03T12:00:00Z") }).length, 0, "Selected financial week does not relocate operational lists");

// Reproduce, but do not fix, the explicitly out-of-scope office Map overwrite.
const officeSource = readFileSync(new URL("../src/lib/jobs/queries.ts", import.meta.url), "utf8");
const officeAst = ts.createSourceFile("queries.ts", officeSource, ts.ScriptTarget.Latest, true);
const officeMethod = officeAst.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "getWorkerOperationsDashboard");
assert.ok(officeMethod);
const officeExports = {};
const officeJavascript = ts.transpileModule(officeMethod.getText(officeAst), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.compileFunction(officeJavascript, ["exports", "createClient"])(officeExports, async () => ({ rpc: async (name) => ({ data: name === "get_worker_operations_dashboard"
  ? [{ technician_id: "worker" }]
  : [{ participant_id: "worker", allocated_cents: 10000 }, { participant_id: "worker", allocated_cents: 12000 }], error: null }) }));
equal((await officeExports.getWorkerOperationsDashboard())[0].weekly_allocated_cents, 12000, "Known pre-existing office Map overwrite is still present, not silently fixed");
console.log("KNOWN LIMITATION: getWorkerOperationsDashboard displays 12000, not the 22000 sum, for duplicate regular/manual worker rows (src/lib/jobs/queries.ts:203-210).");

console.log(`PASS manual office cutoff UI: ${checks} checks; executed actual components/queries/export with offline stubs, not a browser pass`);
