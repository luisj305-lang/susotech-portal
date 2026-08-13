import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const shifts = read("../supabase/migrations/20260813010000_technician_shift_primitives.sql");
const documents = read("../supabase/migrations/20260813011000_job_document_metadata_primitives.sql");
const delivery = read("../supabase/migrations/20260813012000_job_delivery_audit_primitives.sql");
const hardening = read("../supabase/migrations/20260813013000_harden_job_mutation_boundaries.sql");
const actions = read("../src/lib/jobs/actions.ts");
const deliveryRoute = read("../app/api/trabajos/[id]/pdf-entregado/route.ts");
const jobDetail = read("../app/trabajos/[id]/page.tsx");

assert.match(shifts, /create table if not exists public\.technician_shifts/u);
assert.match(shifts, /technician_id uuid not null references public\.profiles\(id\) on delete restrict/u);
assert.match(shifts, /created_by uuid not null references public\.profiles\(id\) on delete restrict/u);
assert.match(shifts, /active_until = started_at \+ interval '10 hours'/u);
assert.match(shifts, /exclude using gist/u);
assert.match(shifts, /fuel_amount numeric\(12,2\)/u);
assert.match(shifts, /p_fuel_amount <> round\(p_fuel_amount, 2\)/u);
assert.match(shifts, /p_fuel_amount > 9999999999\.99/u);
assert.match(shifts, /technician-shift-fuel/u);
assert.match(shifts, /values \('technician-shift-fuel', 'technician-shift-fuel', false\)/u);
assert.match(shifts, /security definer\s+set search_path = ''/u);
assert.match(shifts, /pg_advisory_xact_lock/u);
assert.match(shifts, /An active shift already exists/u);
assert.match(shifts, /get_my_active_shift/u);
assert.match(shifts, /list_technician_shift_status/u);
assert.match(shifts, /server_now timestamptz/u);
assert.doesNotMatch(shifts, /create or replace function public\.can_access_job/u);

assert.match(documents, /document_type text not null default 'additional'/u);
assert.match(documents, /file_hash text/u);
assert.match(documents, /page_count integer/u);
assert.match(documents, /verification_status/u);
assert.match(documents, /row_number\(\) over \(partition by job_id order by created_at, id\)/u);
assert.match(documents, /Hash and\s+-- page count remain NULL/u);
assert.match(documents, /join public\.job_imports i on i\.job_id = j\.id/u);
assert.match(documents, /i\.source_file_size between 1 and 26214400/u);
assert.match(documents, /job_documents_job_position_idx/u);
assert.match(documents, /job_documents_job_id_id_idx/u);
assert.match(documents, /document_type = 'original'/u);
assert.match(documents, /storage_path !~ \('\^' \|\| job_id::text \|\| '\/\(attachments\|delivered\)\/'\)/u);
assert.match(documents, /pg_advisory_xact_lock/u);
assert.match(documents, /Only additional documents use this confirmation flow/u);
assert.match(documents, /add column if not exists deleted_at timestamptz/u);
assert.match(documents, /set deleted_at = now\(\), deleted_by = actor/u);
assert.doesNotMatch(documents, /delete from public\.job_documents/u);

for (const table of [
  "job_pdf_annotations",
  "job_deliveries",
  "job_delivery_production_lines",
  "job_archive_events",
]) assert.match(delivery, new RegExp(`create table if not exists public\\.${table}`, "u"));
assert.match(delivery, /quantity numeric\(14,2\) not null check \(quantity > 0\)/u);
assert.match(delivery, /source_document_id uuid not null/u);
assert.match(delivery, /foreign key \(job_id, source_document_id\)/u);
assert.match(delivery, /source_page integer not null/u);
assert.match(delivery, /arrow_tip_x numeric\(10,9\)/u);
assert.match(delivery, /source_document_ids uuid\[\]/u);
assert.match(delivery, /insert into public\.job_deliveries/u);
assert.match(delivery, /j\.delivered_pdf_path/u);
assert.match(delivery, /unique \(delivery_id, source_annotation_id\)/u);
assert.match(delivery, /validate_delivery_production_line/u);
assert.match(delivery, /Delivery production lineage is invalid/u);
assert.match(delivery, /technician_type_snapshot text/u);
assert.match(delivery, /unit_rate_snapshot numeric\(12,3\)/u);
assert.match(delivery, /add column if not exists deleted_at timestamptz/u);
assert.match(delivery, /archive_reason_code/u);
assert.match(delivery, /disable trigger validate_job_before_update;[\s\S]*update public\.jobs[\s\S]*enable trigger validate_job_before_update;/u);
assert.match(delivery, /is_legacy boolean/u);
assert.match(delivery, /revoke insert, update, delete/u);

assert.match(hardening, /drop policy if exists "Office staff can manage photos"/u);
assert.match(hardening, /revoke update, delete on public\.job_photos from authenticated/u);
assert.match(hardening, /Admins can delete job evidence objects/u);
assert.match(hardening, /public\.is_admin\(\)/u);
assert.match(hardening, /is_queued_job_cleanup_object/u);
assert.match(hardening, /q\.bucket_id = check_bucket_id/u);
assert.doesNotMatch(hardening, /create policy "Admins can update job evidence objects"/u);
assert.doesNotMatch(hardening, /create policy "Office staff can add photos"/u);
assert.doesNotMatch(hardening, /create policy "Office staff can upload job evidence objects"/u);
assert.match(hardening, /drop policy if exists "Office staff can upload project files"/u);
assert.match(hardening, /create policy "Office staff can upload project files"/u);
assert.match(hardening, /name ~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]/u);
assert.match(hardening, /and not public\.is_referenced_project_file\(name\)/u);
assert.match(hardening, /Supervisors can delete unreferenced original uploads/u);
assert.match(hardening, /not public\.is_referenced_project_file\(name\)/u);
assert.match(hardening, /guard_job_archive_fields/u);
assert.match(hardening, /app\.job_archive_mutation/u);
assert.match(hardening, /create or replace function public\.set_job_archived/u);
assert.match(hardening, /insert into public\.job_archive_events/u);
assert.match(hardening, /Archive fields must be changed through the audited archive operation/u);
assert.match(hardening, /guard_job_submission_confirmation/u);
assert.match(hardening, /app\.delivered_pdf_confirmation/u);
assert.match(hardening, /Job submission requires an atomically confirmed delivered PDF/u);
assert.match(hardening, /elsif public\.is_admin\(actor\)/u);
assert.doesNotMatch(hardening, /elsif public\.is_office_staff\(actor\)/u);

assert.match(actions, /input\.newStatus === "enviado_revision"/u);
assert.match(actions, /editor/u);
assert.match(deliveryRoute, /const isAdmin = profile\.role === "admin"/u);
assert.doesNotMatch(deliveryRoute, /const isOffice/u);
assert.match(jobDetail, /canRegenerate=\{profile\.role === "admin"\}/u);

for (const sql of [shifts, documents, delivery, hardening]) {
  assert.doesNotMatch(sql, /signed_url|signedUrl/iu);
}

console.log("PASS major update phase 1 static checks");
