import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20260813038000_worker_specialties_and_capabilities.sql", import.meta.url), "utf8");

for (const specialty of ["tecnico", "splicer", "liner", "ayudante"]) {
  assert.match(sql, new RegExp(`'${specialty}'`, "u"), `missing specialty ${specialty}`);
}
assert.match(sql, /update public\.profiles[\s\S]*role = 'tecnico'[\s\S]*worker_specialty is null/u, "missing technician backfill");
assert.match(sql, /role = 'tecnico' and worker_specialty in \('tecnico', 'splicer', 'liner', 'ayudante'\)/u, "missing role/specialty constraint");
assert.match(sql, /new\.worker_specialty := coalesce\(new\.worker_specialty, 'tecnico'\)/u, "missing technician-only default");
assert.match(sql, /create or replace function public\.guard_operational_worker_eligibility\(\)/u, "missing eligibility transition guard");
assert.match(sql, /ja\.technician_id = old\.id and ja\.assignee_type = 'technician'[\s\S]*ja\.active and ja\.is_primary/u, "eligibility guard must cover active primary direct assignments");
assert.match(sql, /before update of role, is_active, worker_specialty on public\.profiles/u, "eligibility guard must cover role, active status, and specialty changes");
assert.match(sql, /create or replace function public\.is_field_worker/u);
assert.match(sql, /create or replace function public\.is_operational_worker/u);
assert.match(sql, /create or replace function public\.is_read_only_helper/u);
assert.match(sql, /create or replace function public\.can_view_job/u);
assert.match(sql, /create or replace function public\.can_mutate_job/u);
assert.match(sql, /select public\.can_view_job\(check_job_id, check_user_id\)/u, "can_access_job must be the compatibility alias");
assert.match(sql, /on public\.jobs for update to authenticated[\s\S]*public\.can_mutate_job\(id\)/u, "job UPDATE policy must use mutation capability");
assert.match(sql, /on public\.job_production_codes for insert[\s\S]*public\.can_mutate_job\(job_id\)/u, "production INSERT policy must use mutation capability");
assert.match(sql, /on public\.job_photos for insert[\s\S]*public\.can_mutate_job\(job_id\)/u, "photo INSERT policy must use mutation capability");
assert.match(sql, /on storage\.objects for insert[\s\S]*bucket_id = 'job-evidence'[\s\S]*public\.can_mutate_job/u, "evidence INSERT must use mutation capability");
assert.match(sql, /create or replace function public\.validate_job_update\(\)[\s\S]*if not public\.can_mutate_job\(old\.id\)/u, "job trigger must use mutation capability");
for (const rpc of ["add_job_production", "initialize_job_pdf_draft_v2", "save_job_pdf_draft_v2", "confirm_delivered_job_pdf_complete"]) {
  assert.match(sql, new RegExp(`create function public\\.${rpc}\\([\\s\\S]*?can_mutate_job\\(p_job_id`, "u"), `${rpc} must be wrapped by mutation capability`);
}
assert.match(sql, /not public\.is_operational_worker\(new\.technician_id\)/u, "assignment trigger must reject helpers");
assert.match(sql, /new_assignee_type = 'technician' and not public\.is_operational_worker\(new_assignee_id\)/u, "assignment RPC must reject helpers");
assert.match(sql, /p_assignee_type = 'technician' and not public\.is_operational_worker\(p_assignee_id\)/u, "import RPC must reject helpers");
assert.match(sql, /create or replace function public\.set_worker_specialty\([\s\S]*p_profile_id uuid,[\s\S]*p_worker_specialty text/u);
assert.match(sql, /if not public\.is_admin\(auth\.uid\(\)\) then raise exception 'Admin access required'/u);
assert.match(sql, /returns table\([\s\S]*worker_specialty text/u, "office directory must expose specialty");

console.log("[worker-specialty-static] PASS");
