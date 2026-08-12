import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/202608100300_job_pdf_deletion.sql", import.meta.url), "utf8");
const actions = readFileSync(new URL("../src/lib/storage/actions.ts", import.meta.url), "utf8");
const documents = readFileSync(new URL("../src/components/jobs/job-documents.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/trabajos/[id]/page.tsx", import.meta.url), "utf8");
const purge = readFileSync(new URL("./purge-job-pdfs.mjs", import.meta.url), "utf8");

const checks = [
  [migration.includes("clear_job_pdf_reference"), "atomic clear RPC"],
  [migration.includes("for update"), "job row lock"],
  [migration.includes("The private Storage object must be deleted first"), "storage-first invariant"],
  [migration.includes("public.is_admin(actor)"), "admin guard"],
  [migration.includes("not public.is_referenced_project_file(name)"), "supervisor only deletes unreferenced uploads"],
  [migration.includes("delivered_pdf_source_photo_ids = '{}'::uuid[]"), "delivered snapshot cleanup"],
  [actions.includes("export async function deleteJobPdf"), "delete action"],
  [actions.includes("await requireAdmin()"), "action admin guard"],
  [actions.indexOf('.remove([path])') < actions.indexOf('supabase.rpc("clear_job_pdf_reference"'), "storage before RPC"],
  [documents.includes("Eliminar PDF original") && documents.includes("Eliminar PDF entregado"), "individual buttons"],
  [page.includes('canDelete={profile.role === "admin"}'), "admin-only UI"],
  [purge.includes("DELETE_ALL_JOB_PDFS") && purge.includes('mode: execute ? "execute" : "dry-run"'), "guarded dry-run purge"],
  [purge.includes('listObjects("job-evidence")') && !purge.includes('from("job-evidence").remove'), "evidence preserved"],
];

for (const [condition, label] of checks) assert.ok(condition, label);
console.log(`PDF deletion static: PASS (${checks.length} checks)`);
