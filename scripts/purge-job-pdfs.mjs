import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const confirmation = "DELETE_ALL_JOB_PDFS";

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
const suppliedConfirmation = confirmationIndex >= 0 ? process.argv[confirmationIndex + 1] : "";
if (execute && suppliedConfirmation !== confirmation) {
  throw new Error(`Execution requires --confirmation ${confirmation}`);
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function allRows(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
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
  const jobs = await allRows("jobs", "id,project_pdf_url,delivered_pdf_path");
  const photos = await allRows("job_photos", "id");
  const evidence = await listObjects("job-evidence");
  const projectFiles = await listObjects("project-files");
  return { jobs, photos, evidence, projectFiles };
}

const before = await snapshot();
const references = before.jobs.flatMap((job) => [
  job.project_pdf_url && { jobId: job.id, kind: "original", path: job.project_pdf_url },
  job.delivered_pdf_path && { jobId: job.id, kind: "delivered", path: job.delivered_pdf_path },
]).filter(Boolean);
const pdfObjects = before.projectFiles.filter((path) => path.toLowerCase().endsWith(".pdf"));

console.log(JSON.stringify({
  mode: execute ? "execute" : "dry-run",
  jobs: before.jobs.length,
  photos: before.photos.length,
  evidenceObjects: before.evidence.length,
  referencedPdfs: references.length,
  storedPdfs: pdfObjects.length,
}, null, 2));

if (!execute) {
  console.log(`Dry-run only. To execute: node scripts/purge-job-pdfs.mjs --execute --confirmation ${confirmation}`);
  process.exit(0);
}

const removed = new Set();
for (const reference of references) {
  if (!removed.has(reference.path)) {
    const { error } = await service.storage.from("project-files").remove([reference.path]);
    if (error) throw new Error(`Storage deletion failed for ${reference.path}: ${error.message}`);
    removed.add(reference.path);
  }
  const { error } = await service.rpc("clear_job_pdf_reference", {
    p_job_id: reference.jobId,
    p_document_kind: reference.kind,
    p_expected_path: reference.path,
  });
  if (error) throw new Error(`Reference cleanup failed for ${reference.jobId}/${reference.kind}: ${error.message}`);
}

for (const path of pdfObjects.filter((item) => !removed.has(item))) {
  const { error } = await service.storage.from("project-files").remove([path]);
  if (error) throw new Error(`Orphan PDF deletion failed for ${path}: ${error.message}`);
}

const after = await snapshot();
const remainingReferences = after.jobs.filter((job) => job.project_pdf_url || job.delivered_pdf_path);
const remainingPdfs = after.projectFiles.filter((path) => path.toLowerCase().endsWith(".pdf"));
if (after.jobs.length !== before.jobs.length) throw new Error("Job count changed during purge.");
if (after.photos.length !== before.photos.length) throw new Error("Photo count changed during purge.");
if (after.evidence.length !== before.evidence.length) throw new Error("Evidence object count changed during purge.");
if (remainingReferences.length || remainingPdfs.length) throw new Error("PDF purge verification failed.");

console.log(JSON.stringify({
  result: "PASS",
  jobsPreserved: after.jobs.length,
  photosPreserved: after.photos.length,
  evidenceObjectsPreserved: after.evidence.length,
  pdfsRemoved: pdfObjects.length,
}, null, 2));
