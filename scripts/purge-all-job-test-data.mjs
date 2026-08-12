import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const requiredConfirmation = "DELETE_ALL_JOB_TEST_DATA";

function loadEnv(file) {
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if (/^(['"]).*\1$/u.test(value)) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(new URL("../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Missing Supabase environment variables.");

const execute = process.argv.includes("--execute");
const confirmationIndex = process.argv.indexOf("--confirmation");
const confirmation = confirmationIndex >= 0 ? process.argv[confirmationIndex + 1] : "";
if (execute && confirmation !== requiredConfirmation) {
  throw new Error(`Execution requires --confirmation ${requiredConfirmation}`);
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function count(table) {
  const { count: value, error } = await service.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return value ?? 0;
}

async function listObjects(bucket, prefix = "", visited = new Set()) {
  if (visited.has(prefix)) return [];
  visited.add(prefix);
  const objects = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await service.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) objects.push(path);
      else objects.push(...await listObjects(bucket, path, visited));
    }
    if (!data || data.length < 100) break;
  }
  return objects;
}

async function snapshot() {
  const [jobs, photos, assignments, history, codes, imports, batches, items, users, crews, evidence, projectFiles] = await Promise.all([
    count("jobs"),
    count("job_photos"),
    count("job_assignments"),
    count("job_status_history"),
    count("job_production_codes"),
    count("job_imports"),
    count("job_import_batches"),
    count("job_import_items"),
    count("profiles"),
    count("crews"),
    listObjects("job-evidence"),
    listObjects("project-files"),
  ]);
  return { jobs, photos, assignments, history, codes, imports, batches, items, users, crews, evidence, projectFiles };
}

async function removeObjects(bucket, paths) {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await service.storage.from(bucket).remove(paths.slice(index, index + 100));
    if (error) throw new Error(`Failed to purge ${bucket}: ${error.message}`);
  }
}

const before = await snapshot();
console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", ...before, evidence: before.evidence.length, projectFiles: before.projectFiles.length }, null, 2));

if (!execute) {
  console.log(`Dry-run only. To execute: node scripts/purge-all-job-test-data.mjs --execute --confirmation ${requiredConfirmation}`);
  process.exit(0);
}

await removeObjects("job-evidence", before.evidence);
await removeObjects("project-files", before.projectFiles);

const { error: batchError } = await service.from("job_import_batches").delete().not("id", "is", null);
if (batchError) throw new Error(`Failed to delete import batches: ${batchError.message}`);
const { error: jobError } = await service.from("jobs").delete().not("id", "is", null);
if (jobError) throw new Error(`Failed to delete jobs: ${jobError.message}`);

const after = await snapshot();
for (const key of ["jobs", "photos", "assignments", "history", "codes", "imports", "batches", "items"]) {
  if (after[key] !== 0) throw new Error(`Reset verification failed: ${key}=${after[key]}`);
}
if (after.evidence.length || after.projectFiles.length) throw new Error("Storage reset verification failed.");
if (after.users !== before.users || after.crews !== before.crews) throw new Error("Users or crews changed during reset.");

console.log(JSON.stringify({
  result: "PASS",
  jobsRemoved: before.jobs,
  evidenceRowsRemoved: before.photos,
  evidenceObjectsRemoved: before.evidence.length,
  importItemsRemoved: before.items,
  usersPreserved: after.users,
  crewsPreserved: after.crews,
}, null, 2));
