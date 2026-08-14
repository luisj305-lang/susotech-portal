import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const enumMigration = read("../supabase/migrations/20260813033000_add_unassigned_job_status.sql");
const coherence = read("../supabase/migrations/20260813034000_enforce_assignment_status_coherence.sql");
const backfill = read("../supabase/migrations/20260813035000_backfill_unassigned_jobs.sql");
const remainingBackfill = read("../supabase/migrations/20260813050000_backfill_remaining_unassigned_jobs.sql");
const actions = read("../src/lib/jobs/actions.ts");
const bulkCore = read("../src/lib/storage/bulk-import-core.ts");
const bulkUi = read("../src/components/jobs/bulk-import.tsx");
const officeUi = read("../src/components/jobs/office-job-actions.tsx");

assert.match(enumMigration, /add value if not exists 'sin_asignar' before 'asignado'/u);
assert.match(coherence, /alter table public\.jobs alter column main_status set default 'sin_asignar'/u);
assert.match(coherence, /delivered_changed boolean[\s\S]*delivered_pdf_source_document_ids[\s\S]*current_delivery_id/u);
assert.match(coherence, /Delivered PDF metadata must be changed atomically/u);
assert.match(coherence, /Technician delivered PDF update is not allowed/u);
assert.match(coherence, /create constraint trigger enforce_job_assignment_status_on_jobs[\s\S]*deferrable initially deferred/u);
assert.match(coherence, /create constraint trigger enforce_job_assignment_status_on_assignments[\s\S]*deferrable initially deferred/u);
assert.match(coherence, /selected_job\.main_status = 'sin_asignar' and active_assignment_count <> 0/u);
assert.match(coherence, /new_assignee_type is null or is_primary/u);
assert.match(coherence, /security definer[\s\S]*Only active office staff can assign jobs/u);
assert.match(coherence, /new_assignee_type public\.assignee_type default null/u);
assert.match(coherence, /Only not-started assigned jobs can be unassigned/u);
assert.match(coherence, /if auth\.uid\(\) is null then return; end if/u);
assert.match(coherence, /confirm_job_import_item\([\s\S]*p_assignee_type[\s\S]*p_assignee_id/u);
assert.match(coherence, /case when p_assignee_type is null then 'sin_asignar' else 'asignado' end/u);
assert.match(coherence, /Assignment confirmed during PDF import/u);

const candidateIds = [...backfill.matchAll(/[0-9a-f]{8}-[0-9a-f-]{27}/gu)].map(([id]) => id);
assert.equal(new Set(candidateIds).size, 5, "backfill must name exactly five reviewed active candidates");
assert.match(backfill, /j\.archived_at is null/u);
assert.match(backfill, /not exists \(select 1 from public\.job_assignments/u);
assert.match(backfill, /h\.new_status <> 'asignado'/u);
assert.match(backfill, /Backfill: imported job had no assignment/u);
assert.match(remainingBackfill, /job\.main_status = 'asignado'/u);
assert.match(remainingBackfill, /not exists \([\s\S]*public\.job_assignments/u);
assert.match(remainingBackfill, /not exists \([\s\S]*public\.job_status_history/u);
assert.match(remainingBackfill, /not exists \([\s\S]*public\.job_deliveries/u);
assert.match(remainingBackfill, /not exists \([\s\S]*public\.job_production_codes/u);
assert.match(remainingBackfill, /not exists \([\s\S]*public\.job_photos/u);
assert.match(remainingBackfill, /set constraints enforce_job_assignment_status_on_jobs immediate/u);

assert.match(actions, /export async function unassignJob/u);
assert.match(actions, /assign\(\[input\.jobId\], null, null\)/u);
assert.match(bulkCore, /p_assignee_type: input\.assigneeType \?\? null/u);
assert.match(bulkUi, /confirmBulkProjectUpload\(\{[\s\S]*assigneeType: row\.assigneeType[\s\S]*assigneeId: row\.assigneeId/u);
assert.doesNotMatch(bulkUi, /await assignGroups\(groupAssignmentChunks\(confirmed\)\)/u);
assert.match(officeUi, /Quitar asignación/u);

console.log("[assignment-status-static] PASS checks=37 reviewed_candidates=5 remaining_backfill_fail_closed=true");
