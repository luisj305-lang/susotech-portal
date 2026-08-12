import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase environment variables.");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const anonymous = createClient(url, anonKey, options);
const runId = randomBytes(6).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const userIds = [];
const jobIds = [];
const objects = { "project-files": [], "job-evidence": [] };
let checks = 0;
let cleanupPassed = false;

function check(condition, label, error) {
  if (!condition) throw new Error(`${label} [${error?.code ?? error?.message ?? "assertion"}]`);
  checks += 1;
}

async function ok(label, promise) {
  const result = await promise;
  check(!result.error, label, result.error);
  return result.data;
}

async function denied(label, promise) {
  const result = await promise;
  check(Boolean(result.error), label);
  return result.error;
}

async function storageDeleteDenied(label, client, path) {
  await client.storage.from("project-files").remove([path]);
  const retained = await service.storage.from("project-files").download(path);
  check(!retained.error && Boolean(retained.data), label, retained.error);
}

async function identity(label, role) {
  const email = `pdf-delete-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} id`);
  userIds.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: true }).eq("id", id));
  const client = createClient(url, anonKey, options);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function upload(bucket, path, contentType) {
  await ok(`upload ${bucket}/${path}`, service.storage.from(bucket).upload(
    path,
    contentType === "application/pdf" ? new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]) : new Uint8Array([255, 216, 255, 217]),
    { contentType, upsert: false },
  ));
  objects[bucket].push(path);
}

async function cleanup() {
  const errors = [];
  if (jobIds.length && (await service.from("jobs").delete().in("id", jobIds)).error) errors.push("jobs");
  for (const [bucket, paths] of Object.entries(objects)) {
    if (paths.length && (await service.storage.from(bucket).remove(paths)).error) errors.push(bucket);
  }
  for (const id of userIds.reverse()) {
    if ((await service.auth.admin.deleteUser(id)).error) errors.push(`user:${id}`);
  }
  if (errors.length) throw new Error(`cleanup failed: ${errors.join(", ")}`);
  cleanupPassed = true;
}

try {
  const migrationProbe = await service.rpc("clear_job_pdf_reference", {
    p_job_id: randomUUID(), p_document_kind: "original", p_expected_path: `${randomUUID()}/probe.pdf`,
  });
  check(migrationProbe.error?.code !== "PGRST202", "deletion RPC exists", migrationProbe.error);

  const admin = await identity("admin", "admin");
  const supervisor = await identity("supervisor", "supervisor");
  const technician = await identity("technician", "tecnico");
  const jobId = randomUUID();
  const originalPath = `${jobId}/original-${runId}.pdf`;
  const deliveredPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  const evidencePath = `${jobId}/${randomUUID()}.jpg`;
  const photoId = randomUUID();
  jobIds.push(jobId);
  await upload("project-files", originalPath, "application/pdf");
  await upload("project-files", deliveredPath, "application/pdf");
  await upload("job-evidence", evidencePath, "image/jpeg");
  await ok("create job with both PDF pointers", service.from("jobs").insert({
    id: jobId,
    title: `PDF deletion ${runId}`,
    main_status: "en_progreso",
    project_pdf_url: originalPath,
    delivered_pdf_path: deliveredPath,
    delivered_pdf_generated_at: new Date().toISOString(),
    delivered_pdf_generated_by: admin.id,
    delivered_pdf_source_photo_ids: [photoId],
  }));
  await ok("create preserved evidence row", service.from("job_photos").insert({
    id: photoId, job_id: jobId, storage_path: evidencePath, photo_type: "evidence", uploaded_by: technician.id,
  }));

  await storageDeleteDenied("supervisor cannot delete referenced original", supervisor.client, originalPath);
  await storageDeleteDenied("technician cannot delete referenced original", technician.client, originalPath);
  await storageDeleteDenied("anonymous cannot delete referenced original", anonymous, originalPath);
  await denied("supervisor cannot clear original pointer", supervisor.client.rpc("clear_job_pdf_reference", {
    p_job_id: jobId, p_document_kind: "original", p_expected_path: originalPath,
  }));
  await denied("RPC refuses pointer cleanup before object deletion", admin.client.rpc("clear_job_pdf_reference", {
    p_job_id: jobId, p_document_kind: "original", p_expected_path: originalPath,
  }));

  await ok("admin deletes original object", admin.client.storage.from("project-files").remove([originalPath]));
  await ok("admin clears original pointer", admin.client.rpc("clear_job_pdf_reference", {
    p_job_id: jobId, p_document_kind: "original", p_expected_path: originalPath,
  }));
  await ok("original cleanup is idempotent", admin.client.rpc("clear_job_pdf_reference", {
    p_job_id: jobId, p_document_kind: "original", p_expected_path: originalPath,
  }));

  await ok("admin deletes delivered object", admin.client.storage.from("project-files").remove([deliveredPath]));
  await ok("admin clears delivered pointer", admin.client.rpc("clear_job_pdf_reference", {
    p_job_id: jobId, p_document_kind: "delivered", p_expected_path: deliveredPath,
  }));

  const finalJob = await ok("read preserved job", service.from("jobs")
    .select("id,main_status,project_pdf_url,delivered_pdf_path,delivered_pdf_generated_at,delivered_pdf_generated_by,delivered_pdf_source_photo_ids")
    .eq("id", jobId).single());
  check(finalJob.project_pdf_url === null, "original pointer cleared");
  check(finalJob.delivered_pdf_path === null && finalJob.delivered_pdf_generated_at === null && finalJob.delivered_pdf_generated_by === null, "delivered metadata cleared");
  check(finalJob.delivered_pdf_source_photo_ids?.length === 0, "delivered evidence snapshot cleared");
  check(finalJob.main_status === "en_progreso", "workflow status preserved");
  const photo = await ok("evidence row preserved", service.from("job_photos").select("id,storage_path").eq("id", photoId).single());
  check(photo.storage_path === evidencePath, "evidence reference unchanged");
  const evidence = await service.storage.from("job-evidence").download(evidencePath);
  check(!evidence.error && Boolean(evidence.data), "evidence object preserved", evidence.error);

  const tempPath = `${randomUUID()}/duplicate-${runId}.pdf`;
  await upload("project-files", tempPath, "application/pdf");
  await ok("supervisor still deletes unreferenced duplicate upload", supervisor.client.storage.from("project-files").remove([tempPath]));
} finally {
  await cleanup();
}

check(cleanupPassed, "cleanup completed");
console.log(`Job PDF deletion runtime: PASS (${checks} checks, cleanup PASS)`);
