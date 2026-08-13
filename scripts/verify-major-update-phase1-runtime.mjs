import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase test environment");

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const service = createClient(url, serviceKey, clientOptions);
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const users = [];
const objects = { "job-evidence": [], "project-files": [] };
const cleanupQueueIds = [];
let jobId;
let checks = 0;
let cleanupPassed = false;

function check(value, label, error) {
  assert.ok(value, `${label}${error ? ` [${error.code ?? error.message}]` : ""}`);
  checks += 1;
}

async function ok(label, request) {
  const result = await request;
  check(!result.error, label, result.error);
  return result.data;
}

async function denied(label, request) {
  const result = await request;
  const empty = Array.isArray(result.data) && result.data.length === 0;
  check(Boolean(result.error) || empty, label, result.error);
}

async function identity(label, role) {
  const email = `phase1-${runId}-${label}@example.com`;
  const created = await ok(
    `create ${label}`,
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  users.push(id);
  await ok(
    `configure ${label}`,
    service.from("profiles").update({
      role,
      is_active: true,
      full_name: `Phase 1 ${label}`,
    }).eq("id", id).select("id").single(),
  );
  const client = createClient(url, anonKey, clientOptions);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function cleanup() {
  const errors = [];
  for (const [bucket, paths] of Object.entries(objects)) {
    if (paths.length && (await service.storage.from(bucket).remove(paths)).error) errors.push(bucket);
  }
  if (
    cleanupQueueIds.length
    && (await service.from("job_deletion_cleanup_queue").delete().in("id", cleanupQueueIds)).error
  ) {
    errors.push("job_deletion_cleanup_queue");
  }
  if (jobId) {
    if ((await service.from("job_archive_events").delete().eq("job_id", jobId)).error) {
      errors.push("job_archive_events");
    }
    if ((await service.from("jobs").delete().eq("id", jobId)).error) errors.push("jobs");
  }
  if (users.length && (await service.from("technician_shifts").delete().in("technician_id", users)).error) {
    errors.push("technician_shifts");
  }
  for (const id of [...users].reverse()) {
    if ((await service.auth.admin.deleteUser(id)).error) errors.push("users");
  }
  cleanupPassed = errors.length === 0;
  if (errors.length) throw new Error(`Cleanup failed: ${[...new Set(errors)].join(", ")}`);
}

async function main() {
  const admin = await identity("admin", "admin");
  const supervisor = await identity("supervisor", "supervisor");
  const technician = await identity("technician", "tecnico");

  const shift = await ok("technician starts no-fuel shift", technician.client.rpc(
    "start_technician_shift",
    { p_no_fuel_today: true, p_fuel_amount: 0, p_fuel_photo_path: null },
  ));
  check(shift.length === 1, "shift RPC returns one row");
  check(Number(shift[0].fuel_amount) === 0 && shift[0].no_fuel_today, "no-fuel state is explicit");
  check(
    new Date(shift[0].active_until).getTime() - new Date(shift[0].started_at).getTime()
      === 10 * 60 * 60 * 1000,
    "shift lasts exactly ten hours",
  );
  await denied("overlapping shift denied", technician.client.rpc("start_technician_shift", {
    p_no_fuel_today: true,
    p_fuel_amount: 0,
    p_fuel_photo_path: null,
  }));
  await denied("supervisor cannot start shift", supervisor.client.rpc("start_technician_shift", {
    p_no_fuel_today: true,
    p_fuel_amount: 0,
    p_fuel_photo_path: null,
  }));
  await denied("technician cannot insert shift directly", technician.client.from("technician_shifts").insert({
    technician_id: technician.id,
    started_at: "2099-01-01T00:00:00.000Z",
    active_until: "2099-01-01T10:00:00.000Z",
    fuel_amount: 0,
    no_fuel_today: true,
    created_by: technician.id,
  }).select("id"));
  const officeShifts = await ok(
    "supervisor lists shift status",
    supervisor.client.rpc("list_technician_shift_status"),
  );
  check(
    officeShifts.some((row) => row.technician_id === technician.id && row.is_shift_active),
    "office sees active shift",
  );
  await denied("technician cannot list office shift status", technician.client.rpc("list_technician_shift_status"));

  const job = await ok(
    "supervisor creates job",
    supervisor.client.from("jobs").insert({ title: `Phase 1 ${runId}` }).select("id").single(),
  );
  jobId = job.id;
  await ok("supervisor assigns technician", supervisor.client.rpc("assign_jobs_atomic", {
    job_ids: [jobId],
    new_assignee_type: "technician",
    new_assignee_id: technician.id,
  }));
  await ok(
    "technician starts job",
    technician.client.from("jobs").update({ main_status: "en_progreso" }).eq("id", jobId).select("id").single(),
  );
  await denied(
    "direct submission is denied",
    technician.client.from("jobs").update({ main_status: "enviado_revision" }).eq("id", jobId).select("id").single(),
  );

  const evidencePath = `${jobId}/${randomUUID()}.png`;
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=",
    "base64",
  );
  await denied(
    "supervisor cannot upload technician evidence",
    supervisor.client.storage.from("job-evidence").upload(evidencePath, tinyPng, {
      contentType: "image/png",
      upsert: false,
    }),
  );
  await ok(
    "technician uploads evidence",
    technician.client.storage.from("job-evidence").upload(evidencePath, tinyPng, {
      contentType: "image/png",
      upsert: false,
    }),
  );
  objects["job-evidence"].push(evidencePath);
  const photoId = randomUUID();
  await denied("supervisor cannot register evidence", supervisor.client.from("job_photos").insert({
    id: randomUUID(),
    job_id: jobId,
    storage_path: `${jobId}/${randomUUID()}.png`,
    photo_type: "evidence",
    uploaded_by: supervisor.id,
  }).select("id"));
  await ok("technician registers evidence", technician.client.from("job_photos").insert({
    id: photoId,
    job_id: jobId,
    storage_path: evidencePath,
    photo_type: "evidence",
    uploaded_by: technician.id,
  }));
  await denied(
    "supervisor cannot delete evidence row",
    supervisor.client.from("job_photos").delete().eq("id", photoId).select("id"),
  );
  const retainedPhoto = await ok(
    "denied evidence deletion leaves the row intact",
    service.from("job_photos").select("id").eq("id", photoId).single(),
  );
  check(retainedPhoto.id === photoId, "evidence row remains after denied deletion");
  await denied("supervisor cannot regenerate delivered PDF", supervisor.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId,
    p_storage_path: `${jobId}/delivered/${randomUUID()}.pdf`,
    p_source_photo_ids: [photoId],
    p_source_document_ids: [],
    p_submit: false,
    p_expected_draft_version: 0,
    p_snapshot_hash: "0".repeat(64),
  }));

  const pdf = Buffer.alloc(64, 32);
  pdf.write("%PDF-1.4\n");
  const pdfHash = createHash("sha256").update(pdf).digest("hex");
  await denied("supervisor cannot prepare additional PDF", supervisor.client.rpc("prepare_job_document_v2", {
    p_job_id: jobId,
    p_display_name: "supervisor.pdf",
    p_mime_type: "application/pdf",
    p_size_bytes: 64,
    p_file_hash: pdfHash,
  }));
  const prepared = await ok("admin prepares additional PDF", admin.client.rpc("prepare_job_document_v2", {
    p_job_id: jobId,
    p_display_name: "additional.pdf",
    p_mime_type: "application/pdf",
    p_size_bytes: 64,
    p_file_hash: pdfHash,
  }));
  check(prepared.length === 1 && prepared[0].storage_path.includes("/attachments/"), "additional path is isolated");
  const documentPath = prepared[0].storage_path;
  await ok("admin uploads additional PDF", admin.client.storage.from("project-files").upload(documentPath, pdf, {
    contentType: "application/pdf",
    upsert: false,
  }));
  objects["project-files"].push(documentPath);
  await ok("admin confirms additional PDF", admin.client.rpc("confirm_job_document_verified", {
    p_document_id: prepared[0].document_id,
    p_file_hash: pdfHash,
    p_page_count: 1,
  }));
  const document = await ok(
    "admin reads confirmed metadata",
    service.from("job_documents").select("document_type,position,status,deleted_at").eq(
      "id",
      prepared[0].document_id,
    ).single(),
  );
  check(document.document_type === "additional" && document.position >= 1, "document type and order persist");
  const queuedCleanup = await ok("admin soft-deletes additional PDF", admin.client.rpc("delete_job_document", {
    p_document_id: prepared[0].document_id,
  }));
  check(queuedCleanup.length === 1, "soft-delete queues the private object");
  cleanupQueueIds.push(queuedCleanup[0].queue_id);
  const deletedDocument = await ok(
    "soft-deleted document remains auditable",
    service.from("job_documents").select("deleted_at,deleted_by").eq("id", prepared[0].document_id).single(),
  );
  check(Boolean(deletedDocument.deleted_at) && deletedDocument.deleted_by === admin.id, "soft-delete actor and time persist");
  await ok(
    "admin removes queued private object",
    admin.client.storage.from("project-files").remove([documentPath]),
  );
  objects["project-files"] = objects["project-files"].filter((path) => path !== documentPath);
  await ok("admin finalizes cleanup queue", admin.client.rpc("finish_job_deletion_cleanup", {
    p_completed_ids: [queuedCleanup[0].queue_id],
    p_failed_ids: [],
    p_error: null,
  }));
  const residualQueue = await ok(
    "completed cleanup leaves no queue fixture",
    service.from("job_deletion_cleanup_queue").select("id").eq("id", queuedCleanup[0].queue_id),
  );
  check(residualQueue.length === 0, "cleanup queue fixture is removed");
  cleanupQueueIds.splice(cleanupQueueIds.indexOf(queuedCleanup[0].queue_id), 1);

  await denied(
    "supervisor cannot write archive fields directly",
    supervisor.client.from("jobs").update({ archive_reason: "bypass" }).eq("id", jobId).select("id").single(),
  );
  await denied("supervisor cannot archive through RPC", supervisor.client.rpc("set_job_archived_v2", {
    p_job_id: jobId,
    p_archived: true,
    p_reason_code: "duplicate_job",
    p_notes: "runtime",
  }));
  await ok("admin archives through narrow RPC", admin.client.rpc("set_job_archived_v2", {
    p_job_id: jobId,
    p_archived: true,
    p_reason_code: "duplicate_job",
    p_notes: "runtime",
  }));
  const archiveEvents = await ok(
    "archive event is auditable",
    service.from("job_archive_events").select("event_type,actor_id,notes").eq("job_id", jobId),
  );
  check(
    archiveEvents.some((event) => event.event_type === "archived" && event.actor_id === admin.id),
    "archive event records actor",
  );
  await ok("admin restores through narrow RPC", admin.client.rpc("set_job_archived_v2", {
    p_job_id: jobId,
    p_archived: false,
    p_reason_code: null,
    p_notes: null,
  }));
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
}
try {
  await cleanup();
} catch (cleanupError) {
  failure ??= cleanupError;
}

if (failure) {
  console.error(`[major-update-phase1-runtime] FAIL ${failure.message} cleanup=${cleanupPassed ? "passed" : "failed"}`);
  process.exitCode = 1;
} else {
  console.log(`[major-update-phase1-runtime] PASS checks=${checks} cleanup=passed`);
}
