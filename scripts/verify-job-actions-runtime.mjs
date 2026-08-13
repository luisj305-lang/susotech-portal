import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { authorizeDownload, confirmPhotoEvidence, preparePhotoUpload } from "../src/lib/storage/core.ts";

function loadEnv(path) {
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/u)) {
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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing required Supabase server environment variables");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options); // Fixture setup/cleanup only.
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const users = [];
const jobs = [];
const objects = [];
let checks = 0;
let cleanupPassed = false;

function check(condition, label, error) {
  if (!condition) throw new Error(`${label} [${error?.code ?? error?.status ?? "assertion"}]`);
  checks += 1;
}

async function ok(label, request) {
  const result = await request;
  check(!result.error, label, result.error);
  return result.data;
}

async function identity(label, role) {
  const email = `jobs-actions-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  users.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: true, full_name: `Actions ${label}` }).eq("id", id));
  const client = createClient(url, anonKey, options);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function startShift(identity, label) {
  const data = await ok(`${label} starts active shift`, identity.client.rpc("start_technician_shift", {
    p_no_fuel_today: true,
    p_fuel_amount: 0,
    p_fuel_photo_path: null,
  }));
  check(Boolean(data?.[0]?.shift_id), `${label} active shift created`);
}

async function cleanup() {
  const errors = [];
  for (const bucket of ["project-files", "job-evidence"]) {
    const paths = objects.filter((row) => row.bucket === bucket).map((row) => row.path);
    if (paths.length && (await service.storage.from(bucket).remove(paths)).error) errors.push(bucket);
  }
  if (jobs.length && (await service.from("jobs").delete().in("id", jobs)).error) errors.push("jobs");
  if (users.length && (await service.from("technician_shifts").delete().in("technician_id", users)).error) errors.push("shifts");
  for (const id of [...users].reverse()) if ((await service.auth.admin.deleteUser(id)).error) errors.push("users");
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`Cleanup failed [${[...new Set(errors)].join(",")}]`);
}

async function main() {
  const supervisor = await identity("supervisor", "supervisor");
  const assigned = await identity("assigned", "tecnico");
  const foreign = await identity("foreign", "tecnico");
  await startShift(assigned, "assigned technician");
  await startShift(foreign, "foreign technician");
  const job = await ok("create evidence fixture", supervisor.client.from("jobs").insert({ title: `Actions ${runId}` }).select("id").single());
  jobs.push(job.id);
  const projectPath = `${job.id}/actions-${runId}.pdf`;
  await ok("upload project fixture", supervisor.client.storage.from("project-files").upload(projectPath, new Uint8Array([37, 80, 68, 70, 45]), { contentType: "application/pdf" }));
  objects.push({ bucket: "project-files", path: projectPath });
  await ok("assign evidence fixture", supervisor.client.rpc("assign_jobs_atomic", { job_ids: [job.id], new_assignee_type: "technician", new_assignee_id: assigned.id }));
  await ok("start evidence fixture", assigned.client.from("jobs").update({ main_status: "en_progreso" }).eq("id", job.id).select("id").single());
  const assignedPdf = await authorizeDownload(assigned.client, { bucket: "project-files", path: projectPath });
  check(assignedPdf.success && assignedPdf.data.expiresIn === 60, "assigned technician receives signed PDF access");
  const foreignPdf = await authorizeDownload(foreign.client, { bucket: "project-files", path: projectPath });
  check(!foreignPdf.success, "foreign technician receives no signed PDF access");

  const jobId = job.id;
  const invalidMime = await preparePhotoUpload(assigned.client, { jobId, mimeType: "text/plain", size: 10 });
  check(!invalidMime.success, "real photo core rejects invalid MIME");
  const invalidSize = await preparePhotoUpload(assigned.client, { jobId, mimeType: "image/jpeg", size: 10 * 1024 * 1024 + 1 });
  check(!invalidSize.success, "real photo core rejects oversized image");
  const foreignPhoto = await preparePhotoUpload(foreign.client, { jobId, mimeType: "image/jpeg", size: 4 });
  check(!foreignPhoto.success, "foreign technician receives no signed photo upload");
  const metadataBefore = await ok("read metadata before interruption", assigned.client.from("job_photos").select("id").eq("job_id", jobId));
  check(metadataBefore.length === 0, "invalid authorization creates no metadata");

  const interrupted = await preparePhotoUpload(assigned.client, { jobId, mimeType: "image/jpeg", size: 4 });
  check(interrupted.success, "assigned technician prepares signed photo upload");
  if (!interrupted.success) throw new Error("Interrupted upload preparation failed");
  const interruptedConfirm = await confirmPhotoEvidence(assigned.client, assigned.id, { jobId, storagePath: interrupted.data.path, photoType: "evidence" });
  check(!interruptedConfirm.success, "unuploaded object cannot be confirmed");
  const afterInterrupted = await ok("read metadata after interruption", assigned.client.from("job_photos").select("id").eq("job_id", jobId));
  check(afterInterrupted.length === 0, "interruption leaves no usable evidence metadata");

  const retried = await preparePhotoUpload(assigned.client, { jobId, mimeType: "image/jpeg", size: 4 });
  check(retried.success, "interrupted photo can be retried");
  if (!retried.success) throw new Error("Retry preparation failed");
  const image = new File([new Uint8Array([255, 216, 255, 217])], "evidence.jpg", { type: "image/jpeg" });
  await ok("upload retry with signed token", assigned.client.storage.from("job-evidence")
    .uploadToSignedUrl(retried.data.path, retried.data.token, image, { contentType: image.type }));
  objects.push({ bucket: "job-evidence", path: retried.data.path });
  const confirmed = await confirmPhotoEvidence(assigned.client, assigned.id, { jobId, storagePath: retried.data.path, photoType: "evidence" });
  check(confirmed.success, "retried upload confirms real metadata");
  const reconfirmed = await confirmPhotoEvidence(assigned.client, assigned.id, { jobId, storagePath: retried.data.path, photoType: "evidence" });
  check(reconfirmed.success, "reconfirmation is idempotent");
  const metadata = await ok("read confirmed metadata", assigned.client.from("job_photos").select("storage_path,uploaded_by").eq("job_id", jobId));
  check(metadata.length === 1 && metadata[0].storage_path === retried.data.path && metadata[0].uploaded_by === assigned.id, "retry stores exactly one attributed photo row");
  const assignedPhoto = await authorizeDownload(assigned.client, { bucket: "job-evidence", path: retried.data.path });
  check(assignedPhoto.success, "assigned technician receives signed photo download");
  const foreignDownload = await authorizeDownload(foreign.client, { bucket: "job-evidence", path: retried.data.path });
  check(!foreignDownload.success, "foreign technician receives no signed photo download");

  const storageActions = readFileSync(new URL("../src/lib/storage/actions.ts", import.meta.url), "utf8");
  const jobActions = readFileSync(new URL("../src/lib/jobs/actions.ts", import.meta.url), "utf8");
  assert.match(storageActions, /prepareBulkProjectUploadCore\(await createClient\(\), input\)/u);
  assert.match(storageActions, /confirmBulkProjectUploadCore\(await createClient\(\), input\)/u);
  assert.match(storageActions, /authorizeDownload\(await createClient\(\), \{ \.\.\.input, expiresIn \}\)/u);
  assert.match(storageActions, /preparePhotoUpload\(await createClient\(\), input\)/u);
  assert.match(jobActions, /confirmPhotoEvidence\(supabase, profile\.id/u);
  checks += 5;
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally { try { await cleanup(); } catch (error) { failure ??= error; } }

if (failure) {
  console.error(`[jobs-actions-runtime] FAIL ${failure.message} cleanup=${cleanupPassed ? "passed" : "failed"}`);
  process.exitCode = 1;
} else {
  console.log(`[jobs-actions-runtime] PASS checks=${checks} cleanup=passed users=${users.length} jobs=${jobs.length} objects=${objects.length}`);
}
