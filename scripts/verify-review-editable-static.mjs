import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260814030000_keep_review_jobs_editable.sql");
const editor = read("src/components/jobs/pdf-code-editor.tsx");
const detail = read("app/trabajos/[id]/page.tsx");
const deliveryPage = read("app/trabajos/[id]/entregar/page.tsx");
const route = read("app/api/trabajos/[id]/pdf-entregado/route.ts");
const actions = read("src/lib/jobs/actions.ts");
const technicianActions = read("src/components/jobs/technician-actions.tsx");
const attachments = read("src/components/jobs/job-attachments.tsx");
const hardenedDelivery = read("supabase/migrations/20260813030000_complete_pdf_delivery_workflow.sql");

const hardenedLines = hardenedDelivery.split(/\r?\n/u);
const expectedInit = hardenedLines.slice(479, 535).join("\n")
  .replace("public.initialize_job_pdf_draft_v2(", "public.initialize_job_pdf_draft_v2_before_capabilities(")
  .replace("selected_job.main_status <> 'en_progreso'", "selected_job.main_status not in ('en_progreso', 'enviado_revision')");
const expectedSave = hardenedLines.slice(536, 647).join("\n")
  .replace("public.save_job_pdf_draft_v2(", "public.save_job_pdf_draft_v2_before_capabilities(")
  .replace("selected_job.main_status <> 'en_progreso'", "selected_job.main_status not in ('en_progreso', 'enviado_revision')");
const expectedConfirm = hardenedLines.slice(648, 812).join("\n")
  .replace("public.confirm_delivered_job_pdf_complete(", "public.confirm_delivered_job_pdf_complete_before_capabilities(")
  .replaceAll("selected_job.main_status <> 'en_progreso'", "selected_job.main_status not in ('en_progreso', 'enviado_revision')")
  .replace("Technicians can only submit jobs in progress", "Technicians can only submit jobs in progress or review");

assert.ok(migration.includes(expectedInit), "review initialization must preserve the hardened implementation");
assert.ok(migration.includes(expectedSave), "review draft saving must preserve the hardened implementation");
assert.ok(migration.includes(expectedConfirm), "review regeneration must preserve the hardened implementation");

for (const functionName of [
  "initialize_job_pdf_draft_v2_before_capabilities",
  "save_job_pdf_draft_v2_before_capabilities",
  "confirm_delivered_job_pdf_complete_before_capabilities",
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${functionName}`, "u"));
}
assert.equal((migration.match(/main_status not in \('en_progreso', 'enviado_revision'\)/gu) ?? []).length, 4);
assert.doesNotMatch(migration, /main_status not in \([^)]*aprobado/u);
assert.match(migration, /Technicians can add photos[\s\S]*main_status in \('en_progreso', 'enviado_revision'\)/u);
assert.match(migration, /Operational workers upload assigned evidence[\s\S]*main_status in \('en_progreso', 'enviado_revision'\)/u);
assert.match(migration, /delete_job_photo_audited[\s\S]*can_mutate_job[\s\S]*main_status in \('en_progreso', 'enviado_revision'\)/u);

assert.doesNotMatch(editor, /Buscar código o descripción|catalogSearch/u);
assert.match(editor, /stage === "edit"[\s\S]*Confirmar PDF[\s\S]*Distribución financiera[\s\S]*Entregar trabajo/u);
assert.match(deliveryPage, /\["asignado", "en_revision"\]\.includes\(detail\.job\.main_status\)/u);
assert.match(route, /\["asignado", "en_revision"\]\.includes\(job\.main_status\)/u);
assert.match(technicianActions, /\["asignado", "en_revision"\]\.includes\(status\)/u);
assert.match(detail, /JobEvidenceList photos=\{photos\} canDelete=/u);
assert.match(detail, /\["asignado", "en_revision"\]\.includes\(job\.main_status\)[\s\S]*PhotoUpload/u);
assert.match(actions, /El administrador cambió los PDFs del trabajo\. Recarga el editor para verlos todos unidos\./u);
assert.match(attachments, /se concatenan en este orden después del original dentro del único PDF final/u);

console.log("PASS review-editable PDF and evidence static checks");
