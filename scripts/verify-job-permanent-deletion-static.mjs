import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/202608110300_job_permanent_deletion.sql");
const actions = read("../src/lib/jobs/actions.ts");
const core = read("../src/lib/jobs/deletion-core.ts");
const component = read("../src/components/jobs/archived-job-delete-button.tsx");
const page = read("../app/trabajos/page.tsx");

assert.match(migration, /foreign key \(confirmed_job_id\) references public\.jobs\(id\) on delete cascade/u);
assert.match(migration, /create table if not exists public\.job_deletion_cleanup_queue/u);
assert.match(migration, /o\.bucket_id in \('project-files', 'job-evidence'\)/u);
assert.match(migration, /o\.name like p_job_id::text \|\| '\/%'/u);
assert.match(migration, /selected_job\.archived_at is null/u);
assert.match(migration, /on conflict on constraint job_deletion_cleanup_queue_bucket_id_object_name_key/u);
assert.match(migration, /not public\.is_admin\(actor\)/u);
assert.match(migration, /drop policy if exists "Admins can delete jobs"/u);
assert.match(migration, /revoke delete on public\.jobs from authenticated/u);
assert.match(actions, /export async function deleteArchivedJob/u);
assert.match(actions, /await requireAdmin\(\)/u);
assert.match(actions, /cleanupJobDeletionQueue/u);
assert.match(actions, /export async function retryPendingJobDeletionCleanup/u);
assert.match(core, /finish_job_deletion_cleanup/u);
assert.match(core, /objectExists/u);
assert.match(component, /window\.confirm/u);
assert.match(component, /Esta acción no se puede deshacer/u);
assert.match(component, /disabled=\{pending\}/u);
assert.match(page, /filters\.archived && profile\.role === "admin"/u);
assert.match(page, /ArchivedJobDeleteButton/u);

console.log("PASS permanent archived-job deletion static checks");
