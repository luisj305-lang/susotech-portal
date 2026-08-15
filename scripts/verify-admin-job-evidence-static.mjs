import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const detail = read("app/trabajos/[id]/page.tsx");
const storageActions = read("src/lib/storage/actions.ts");
const storageCore = read("src/lib/storage/core.ts");
const jobActions = read("src/lib/jobs/actions.ts");
const migration = read("supabase/migrations/20260815010000_allow_admin_job_evidence.sql");

assert.match(detail, /profile\.role === "admin"[\s\S]*\["en_progreso", "enviado_revision"\]\.includes\(job\.main_status\)[\s\S]*<PhotoUpload/u);
assert.match(storageActions, /createPhotoUploadUrl[\s\S]*profile\.role !== "admin" && !isOperationalFieldWorker\(profile\)/u);
assert.match(storageActions, /discardUnconfirmedPhotoUpload[\s\S]*profile\.role !== "admin" && !isOperationalFieldWorker\(profile\)/u);
assert.match(storageCore, /\.in\("main_status", \["en_progreso", "enviado_revision"\]\)[\s\S]*\.is\("archived_at", null\)/u);
assert.match(jobActions, /addPhotoComment[\s\S]*confirmPhotoEvidence\(supabase, profile\.id/u);
assert.match(migration, /Authorized users can add job evidence[\s\S]*public\.is_admin\(auth\.uid\(\)\)[\s\S]*public\.is_operational_worker/u);
assert.match(migration, /Authorized users upload editable job evidence[\s\S]*public\.is_admin\(auth\.uid\(\)\)[\s\S]*public\.can_mutate_job/u);
assert.match(migration, /Authorized users update editable job evidence[\s\S]*public\.is_admin\(auth\.uid\(\)\)[\s\S]*public\.can_mutate_job/u);
assert.equal((migration.match(/j\.archived_at is null/gu) ?? []).length, 4);
assert.equal((migration.match(/j\.main_status in \('en_progreso', 'enviado_revision'\)/gu) ?? []).length, 4);

console.log("PASS admin job evidence static checks");
