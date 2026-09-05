#!/usr/bin/env node
// scripts/verify-admin-dashboard-contracts.mjs
//
// Offline contract checks for the administrator dashboard visual refresh.
// Executes the REAL `src/lib` query/format/week/PDF-status modules against
// in-memory fake clients through an allowlisted, TypeScript-transpiling
// loader. No Supabase SDK, no network, no environment, no browser.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";

// ---------------------------------------------------------------------------
// Allowlisted TypeScript loader
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const STUB = "file:///admin-dashboard-stub/";

const STUB_SOURCES = {
  "server-only.mjs": "export {};\n",
  "supabase-server.mjs": [
    "export async function createClient() {",
    "  const fake = globalThis.__ADMIN_DASHBOARD_FAKE_SUPABASE__;",
    "  if (!fake) throw new Error(\"No fake Supabase client configured for offline contracts.\");",
    "  return fake;",
    "}",
    "",
  ].join("\n"),
  "work-shifts-access.mjs": [
    "const access = { active: true, bypassed: true, shift: null };",
    "export async function requireActiveShift() { return access; }",
    "export async function requireActiveShiftPage() { return access; }",
    "export async function getWorkShiftAccess() { return access; }",
    "export async function getWorkShiftAccessForActor() { return access; }",
    "export class ActiveShiftRequiredError extends Error {}",
    "export function isActiveShiftRequiredError() { return false; }",
    "",
  ].join("\n"),
  "crew-core.mjs": [
    "export async function listActiveTechniciansCore() {",
    "  return globalThis.__ADMIN_DASHBOARD_FAKE_TECHNICIANS__ ?? [];",
    "}",
    "",
  ].join("\n"),
};

const ALLOWLIST = new Set([
  "src/lib/jobs/queries.ts",
  "src/lib/dashboard/format.ts",
  "src/lib/time/new-york-week.ts",
  "src/lib/jobs/delivered-status.ts",
  "scripts/fixtures/admin-dashboard.ts",
]);

function toRel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function ensureTsExt(abs) {
  if (path.extname(abs) === "") {
    if (existsSync(`${abs}.ts`)) return `${abs}.ts`;
    if (existsSync(`${abs}.tsx`)) return `${abs}.tsx`;
  }
  return abs;
}

function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: STUB + "server-only.mjs", shortCircuit: true };
  }
  if (specifier === "@/lib/supabase/server" || specifier === "@/lib/supabase/service") {
    return { url: STUB + "supabase-server.mjs", shortCircuit: true };
  }
  if (specifier === "@/lib/work-shifts/access") {
    return { url: STUB + "work-shifts-access.mjs", shortCircuit: true };
  }
  if (specifier.endsWith("crew-core")) {
    return { url: STUB + "crew-core.mjs", shortCircuit: true };
  }

  // Blocklist: real Supabase SDK, Next.js, React, and browser/auth modules
  // must never execute in the offline contract runner.
  if (
    specifier.startsWith("@supabase/") ||
    specifier === "next" ||
    specifier.startsWith("next/") ||
    specifier === "react" ||
    specifier === "react-dom" ||
    specifier.startsWith("react-") ||
    specifier === "@/lib/supabase/client" ||
    specifier === "@/lib/auth/session"
  ) {
    throw new Error(
      `Offline contract loader blocked disallowed import: ${specifier}`,
    );
  }

  if (specifier.startsWith("@/")) {
    const target = path.join(ROOT, "src", specifier.slice(2));
    return { url: pathToFileURL(ensureTsExt(target)).href, shortCircuit: true };
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : ROOT;
    const abs = path.resolve(path.dirname(parent), specifier);
    return { url: pathToFileURL(ensureTsExt(abs)).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

function load(url, context, nextLoad) {
  if (url.startsWith(STUB)) {
    const name = url.slice(STUB.length);
    const source = STUB_SOURCES[name];
    if (!source) throw new Error(`Unknown offline contract stub: ${name}`);
    return { format: "module", source, shortCircuit: true };
  }

  if (url.startsWith("file:")) {
    const filePath = fileURLToPath(url);
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      const rel = toRel(filePath);
      if (!ALLOWLIST.has(rel)) {
        throw new Error(
          `Offline contract loader refused un-allowlisted TypeScript module: ${rel}`,
        );
      }
      const source = readFileSync(filePath, "utf8");
      const output = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
        fileName: filePath,
        reportDiagnostics: false,
      });
      return { format: "module", source: output.outputText, shortCircuit: true };
    }
  }

  return nextLoad(url, context);
}

registerHooks({ resolve, load });

// ---------------------------------------------------------------------------
// Real modules (imported after the loader is registered)
// ---------------------------------------------------------------------------

const fixtures = await import("./fixtures/admin-dashboard.ts");
const {
  listOfficeJobs,
  getWorkerOperationsDashboard,
  getWeeklyInvoicedTotal,
} = await import("../src/lib/jobs/queries.ts");
const { formatWeekRange, formatMoney, formatQuantity } = await import(
  "../src/lib/dashboard/format.ts"
);
const { referenceAtForNewYorkWeek } = await import(
  "../src/lib/time/new-york-week.ts"
);

const { makeFakeSupabase, activeTechnicians } = fixtures;

function setFake(supabase) {
  globalThis.__ADMIN_DASHBOARD_FAKE_SUPABASE__ = supabase;
  globalThis.__ADMIN_DASHBOARD_FAKE_TECHNICIANS__ = activeTechnicians;
}

// ---------------------------------------------------------------------------
// Assertion helpers (count assertions + report)
// ---------------------------------------------------------------------------

let assertions = 0;
let scenarios = 0;

function scenario(name) {
  scenarios += 1;
  process.stdout.write(`\n[${name}]\n`);
}

function ok(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

function eq(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function rejects(promiseFn, pattern, message) {
  assertions += 1;
  await assert.rejects(promiseFn, pattern, message);
}

function src(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// S4 — Week navigation
// ---------------------------------------------------------------------------

async function scenarioS4() {
  scenario("S4 Week navigation");

  // Friday 00:00 → following Friday exclusive, displayed Friday→Thursday.
  eq(
    formatWeekRange("2026-09-04T00:00:00-04:00", "2026-09-11T00:00:00-04:00"),
    "viernes 4 de septiembre – jueves 10 de septiembre",
    "Friday→Thursday New York display",
  );

  // Week-offset navigation is civil-date stable across DST boundaries.
  eq(
    referenceAtForNewYorkWeek(1, new Date("2026-10-30T04:30:00.000Z")),
    "2026-11-06T12:00:00.000Z",
    "fall DST must not move a Friday reference back into Thursday",
  );
  eq(
    referenceAtForNewYorkWeek(-1, new Date("2026-03-13T04:30:00.000Z")),
    "2026-03-06T12:00:00.000Z",
    "spring DST must preserve New York civil-date navigation",
  );
  eq(
    referenceAtForNewYorkWeek(0, new Date("2026-08-14T04:00:00.000Z")),
    "2026-08-14T12:00:00.000Z",
    "Friday midnight in New York stays inside the Friday-starting week",
  );
  eq(
    referenceAtForNewYorkWeek(1, new Date("2026-09-04T04:00:00.000Z")),
    "2026-09-11T12:00:00.000Z",
    "+1 offset advances exactly one New York civil week",
  );

  // Current-week link appears only at a nonzero offset.
  const dashboard = src("src/components/dashboard/admin-dashboard.tsx");
  ok(dashboard.includes("weekOffset !== 0"), "current-week link gated on offset");
  ok(dashboard.includes("Semana actual"), "current-week link label present");
  ok(dashboard.includes("week=${weekOffset - 1}"), "previous-week link decrements offset");
  ok(dashboard.includes("week=${weekOffset + 1}"), "next-week link increments offset");
}

// ---------------------------------------------------------------------------
// S5 — Preview sizes
// ---------------------------------------------------------------------------

async function scenarioS5() {
  scenario("S5 Preview sizes");

  for (const n of [0, 1, 3, 8, 9]) {
    const { config } = fixtures.buildPendingJobsConfig(n);
    setFake(makeFakeSupabase(config));
    const jobs = await listOfficeJobs({ status: "en_revision" });
    eq(jobs.length, n, `listOfficeJobs returns ${n} en_revision jobs`);
    eq(
      jobs.slice(0, 8).length,
      Math.min(n, 8),
      `first-eight preview shows ${Math.min(n, 8)} of ${n}`,
    );
  }

  const { config } = fixtures.buildPendingJobsConfig(9);
  setFake(makeFakeSupabase(config));
  const jobs = await listOfficeJobs({ status: "en_revision" });

  // updated_at descending is preserved (no re-sort in the module).
  for (let i = 1; i < jobs.length; i += 1) {
    ok(
      String(jobs[i - 1].updated_at) >= String(jobs[i].updated_at),
      `updated_at desc order at index ${i}`,
    );
  }

  // Archived and non-en_revision rows never leak into the preview.
  ok(
    jobs.every((job) => job.archived_at === null && job.main_status === "en_revision"),
    "preview contains only non-archived en_revision jobs",
  );

  // All three PDF states are produced.
  const seenStates = new Set(jobs.map((job) => job.delivered_pdf_status));
  ok(seenStates.has("pending"), "pending PDF state present");
  ok(seenStates.has("current"), "current PDF state present");
  ok(seenStates.has("stale"), "stale PDF state present");

  // Assignee labels: unassigned / technician / crew.
  const byId = new Map(jobs.map((job) => [job.id, job]));
  eq(byId.get("pending-0").assignee_label, "Sin asignar", "unassigned label");
  eq(byId.get("pending-1").assignee_label, "Técnico 2", "technician label");
  eq(byId.get("pending-2").assignee_label, "Equipo A", "crew label");

  // Photo counts from the job_photos table.
  eq(byId.get("pending-0").photo_count, 0, "zero-photo count");
  eq(byId.get("pending-1").photo_count, 1, "one-photo count");
  eq(byId.get("pending-3").photo_count, 3, "three-photo count");

  // First-eight contract is a documented slice of the loaded preview.
  const pending = src("src/components/dashboard/pending-review.tsx");
  ok(pending.includes("jobs.slice(0, 8)"), "first-eight slice preserved");
  ok(pending.includes("/trabajos?status=en_revision"), "view-all link preserved");
}

// ---------------------------------------------------------------------------
// S6 — Filtered totals
// ---------------------------------------------------------------------------

async function scenarioS6() {
  scenario("S6 Filtered totals");

  const { config, expected } = fixtures.buildWorkersConfig();
  setFake(makeFakeSupabase(config));
  const rows = await getWorkerOperationsDashboard();

  eq(rows.length, expected.count, "all nine loaded workers returned (no cap)");

  // Allocation cents joined by technician id; integer cents preserved.
  rows.forEach((row, i) => {
    eq(
      row.weekly_allocated_cents,
      expected.allocatedCents[i],
      `allocated cents joined for worker ${i + 1}`,
    );
  });

  // Active flags come from server data, never recomputed.
  eq(rows[0].is_shift_active, true, "server active flag preserved (worker 1)");
  eq(rows[1].is_shift_active, false, "server inactive flag preserved (worker 2)");

  // cents/100 happens at presentation, not in the data layer.
  eq(rows[0].weekly_allocated_cents, 123450, "allocated cents stay integer cents");
  eq(formatMoney(rows[0].weekly_allocated_cents / 100), "$1,234.50", "earnings cents/100 formatting");

  // Money and quantity formatting contracts.
  eq(formatMoney(12345.67), "$12,345.67", "money formatting with separators");
  eq(formatQuantity(3.14159), "3.14", "quantity formatting");

  // Invoiced total: integer cents + delivered jobs.
  const invoiced = await getWeeklyInvoicedTotal();
  eq(invoiced.invoiced_cents, expected.invoicedCents, "invoiced cents are integer cents");
  eq(invoiced.delivered_jobs, expected.deliveredJobs, "delivered jobs count");
  eq(formatMoney(invoiced.invoiced_cents / 100), "$12,345.00", "invoiced cents/100 formatting");

  // All-loaded TOTAL is computed over `rows`, independent of the filter list.
  const table = src("src/components/dashboard/worker-activity-table.tsx");
  ok(table.includes("rows.reduce"), "TOTAL aggregates loaded rows");
  ok(!table.includes("filtered.reduce"), "TOTAL never aggregates filtered rows");
  ok(table.includes("totals.earnings / 100"), "earnings total uses cents/100");
  ok(table.includes("(row.weekly_allocated_cents ?? 0) / 100"), "per-row earnings uses cents/100");
}

// ---------------------------------------------------------------------------
// S7 — Worker details
// ---------------------------------------------------------------------------

async function scenarioS7() {
  scenario("S7 Worker details");

  const { config } = fixtures.buildWorkersConfig();
  setFake(makeFakeSupabase(config));
  const rows = await getWorkerOperationsDashboard();

  // Detalles → production/fuel breakdown data contract.
  ok(Array.isArray(rows[0].production_breakdown), "production breakdown array present");
  ok(rows[0].production_breakdown.length > 0, "production breakdown populated");
  ok(Array.isArray(rows[0].fuel_daily), "fuel daily array present");
  ok(rows[0].fuel_daily.length > 0, "fuel daily populated");
  eq(rows[0].technician_id, "tech-1", "worker identity for name interaction");
  eq(rows[0].technician_name, "Técnico 1", "worker display name for modal title");

  // Name → assigned-jobs RPC and job links; Detalles → breakdowns.
  const table = src("src/components/dashboard/worker-activity-table.tsx");
  ok(table.includes('"list_technician_assigned_jobs"'), "name opens assigned-jobs RPC");
  ok(table.includes("p_technician_id"), "assigned-jobs RPC keyed by technician id");
  ok(table.includes("`/trabajos/${job.id}`"), "assigned jobs link to job detail");
  ok(table.includes("production_breakdown"), "Detalles renders production breakdown");
  ok(table.includes("fuel_daily"), "Detalles renders fuel breakdown");
}

// ---------------------------------------------------------------------------
// S8 — Unavailable content
// ---------------------------------------------------------------------------

async function scenarioS8() {
  scenario("S8 Unavailable content");

  // Empty results return empty arrays, never null.
  setFake(makeFakeSupabase(fixtures.buildEmptyWorkersConfig().config));
  eq(
    (await getWorkerOperationsDashboard()).length,
    0,
    "empty worker operations returns []",
  );

  const emptyPending = fixtures.buildPendingJobsConfig(0).config;
  setFake(makeFakeSupabase(emptyPending));
  eq(
    (await listOfficeJobs({ status: "en_revision" })).length,
    0,
    "empty pending preview returns []",
  );

  setFake(makeFakeSupabase(fixtures.buildEmptyInvoicedConfig().config));
  eq(
    (await getWeeklyInvoicedTotal()).invoiced_cents,
    0,
    "empty invoiced total coerces to zero cents",
  );
  eq(
    (await getWeeklyInvoicedTotal()).delivered_jobs,
    0,
    "empty invoiced total coerces to zero delivered jobs",
  );

  // Failures throw; they never masquerade as zero KPIs.
  setFake(makeFakeSupabase(fixtures.buildJobsErrorConfig().config));
  await rejects(
    () => listOfficeJobs({ status: "en_revision" }),
    /No se pudieron cargar los trabajos\./u,
    "jobs query failure throws",
  );

  setFake(makeFakeSupabase(fixtures.buildWorkersErrorConfig().config));
  await rejects(
    () => getWorkerOperationsDashboard(),
    /No se pudo cargar la operación semanal de trabajadores\./u,
    "worker operations failure throws",
  );

  setFake(makeFakeSupabase(fixtures.buildInvoicedErrorConfig().config));
  await rejects(
    () => getWeeklyInvoicedTotal(),
    /No se pudo cargar el total facturado\./u,
    "invoiced total failure throws",
  );

  // Five quick-action destinations (administrator scope).
  const actions = src("src/components/dashboard/quick-actions.tsx");
  for (const href of [
    "/trabajos/importar",
    "/trabajos",
    "/trabajos?status=en_revision",
    "/equipos",
    "/usuarios",
  ]) {
    ok(actions.includes(`"${href}"`), `quick action destination ${href}`);
  }
  ok(actions.includes('role === "admin"'), "users action is administrator-only");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const caseIndex = process.argv.indexOf("--case");
const caseName = caseIndex !== -1 ? process.argv[caseIndex + 1] : null;

if (caseName === "offline") {
  await scenarioS4();
  await scenarioS5();
  await scenarioS6();
  await scenarioS7();
  await scenarioS8();
  process.stdout.write(
    `\nPASS admin-dashboard offline contracts: ${scenarios} scenarios, ${assertions} assertions\n`,
  );
} else {
  process.stderr.write(
    `verify-admin-dashboard-contracts: case "${caseName ?? "(none)"}" is not implemented in this work unit (offline only).\n`,
  );
  process.exitCode = 2;
}
