import { createHash, randomBytes, randomUUID } from "node:crypto";
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
const objects = { "project-files": [], "job-evidence": [] };
let jobId;
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

async function identity(label, role) {
  const email = `delivered-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} id`);
  userIds.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: true, full_name: `Delivered ${label}` }).eq("id", id));
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

async function upload(bucket, path, bytes, contentType, client = service, metadata) {
  await ok(`upload ${bucket}/${path}`, client.storage.from(bucket).upload(path, bytes, {
    contentType, upsert: false, metadata,
  }));
  objects[bucket].push(path);
}

async function cleanup() {
  const errors = [];
  for (const bucket of Object.keys(objects)) {
    if (objects[bucket].length && (await service.storage.from(bucket).remove(objects[bucket])).error) errors.push(bucket);
  }
  if (jobId && (await service.from("jobs").delete().eq("id", jobId)).error) errors.push("job");
  if (userIds.length && (await service.from("technician_shifts").delete().in("technician_id", userIds)).error) errors.push("shifts");
  for (const id of [...userIds].reverse()) if ((await service.auth.admin.deleteUser(id)).error) errors.push("user");
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`cleanup failed: ${[...new Set(errors)].join(", ")}`);
}

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=", "base64");
const minimalPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

try {
  const admin = await identity("admin", "admin");
  const supervisor = await identity("supervisor", "supervisor");
  const technician = await identity("technician", "tecnico");
  const outsider = await identity("outsider", "tecnico");
  await startShift(technician, "assigned technician");
  await startShift(outsider, "unassigned technician");
  jobId = randomUUID();
  const originalPath = `${jobId}/original.pdf`;
  await ok("create in-progress job", admin.client.from("jobs").insert({
    id: jobId,
    title: `Delivered runtime ${runId}`,
    main_status: "en_progreso",
    project_pdf_url: originalPath,
  }));
  await ok("assign technician", admin.client.rpc("assign_jobs_atomic", {
    job_ids: [jobId], new_assignee_type: "technician", new_assignee_id: technician.id,
  }));
  await upload("project-files", originalPath, minimalPdf, "application/pdf");
  const originalHash = createHash("sha256").update(minimalPdf).digest("hex");
  const originalDocument = await ok("register verified original", service.rpc("ensure_job_original_document", {
    p_job_id: jobId, p_storage_path: originalPath, p_original_filename: "original.pdf",
    p_size_bytes: minimalPdf.length, p_file_hash: originalHash, p_page_count: 1,
  }));
  const documentId = originalDocument;
  const catalog = await ok("read production catalog", service.from("production_code_catalog").select("id").limit(1).single());
  const initialized = await ok("initialize complete draft", technician.client.rpc("initialize_job_pdf_draft_v2", {
    p_job_id: jobId, p_source_document_ids: [documentId], p_page_count: 1,
  }));
  const placement = {
    id: randomUUID(), catalogId: catalog.id, page: 1, sourceDocumentId: documentId,
    sourcePage: 1, quantity: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.08,
    arrowTipX: 0.5, arrowTipY: 0.5,
  };
  const draftVersion = await ok("save complete draft", technician.client.rpc("save_job_pdf_draft_v2", {
    p_job_id: jobId, p_expected_version: initialized[0].version, p_placements: [placement],
  }));
  const snapshotHash = createHash("sha256").update(JSON.stringify([placement])).digest("hex");

  const photoOneId = randomUUID();
  const photoOnePath = `${jobId}/${randomUUID()}.png`;
  await upload("job-evidence", photoOnePath, tinyPng, "image/png", technician.client);
  await ok("technician confirms evidence with comment", technician.client.from("job_photos").insert({
    id: photoOneId,
    job_id: jobId,
    storage_path: photoOnePath,
    photo_type: "evidence",
    uploaded_by: technician.id,
    comment: "Runtime evidence",
  }));

  const missingDeliveredPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  await denied("missing delivered object cannot be confirmed", technician.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId, p_storage_path: missingDeliveredPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: true,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
  }));

  const untrustedDeliveredPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  await upload("project-files", untrustedDeliveredPath, minimalPdf, "application/pdf");
  await denied("untrusted delivered object cannot be confirmed", technician.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId, p_storage_path: untrustedDeliveredPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: true,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
  }));

  const firstDeliveredPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  await upload("project-files", firstDeliveredPath, minimalPdf, "application/pdf", service, {
    generator: "susotech-portal", job_id: jobId, source_photo_ids: photoOneId,
    source_document_ids: documentId, snapshot_hash: snapshotHash,
  });
  await denied("anonymous cannot confirm", anonymous.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId, p_storage_path: firstDeliveredPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: true,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
  }));
  await denied("unassigned technician cannot confirm", outsider.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId, p_storage_path: firstDeliveredPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: true,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
  }));
  await denied("technician cannot update delivered metadata directly", technician.client.from("jobs").update({
    delivered_pdf_path: firstDeliveredPath,
  }).eq("id", jobId));

  const submitted = await ok("technician atomically delivers", technician.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId, p_storage_path: firstDeliveredPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: true,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
  }));
  check(submitted?.[0]?.delivered_status === "enviado_revision", "submission advances existing state");
  const afterSubmit = await ok("read submitted pointer", technician.client.from("jobs")
    .select("main_status, delivered_pdf_path, delivered_pdf_source_photo_ids")
    .eq("id", jobId).single());
  check(afterSubmit.main_status === "enviado_revision" && afterSubmit.delivered_pdf_path === firstDeliveredPath, "atomic pointer persisted");
  check(afterSubmit.delivered_pdf_source_photo_ids?.[0] === photoOneId, "source snapshot persisted");

  const forbiddenPath = `${jobId}/${randomUUID()}.png`;
  await denied("technician cannot upload evidence after submission", technician.client.storage
    .from("job-evidence").upload(forbiddenPath, tinyPng, { contentType: "image/png" }));

  const photoTwoId = randomUUID();
  const photoTwoPath = `${jobId}/${randomUUID()}.png`;
  await upload("job-evidence", photoTwoPath, tinyPng, "image/png");
  await ok("office adds later evidence", service.from("job_photos").insert({
    id: photoTwoId,
    job_id: jobId,
    storage_path: photoTwoPath,
    photo_type: "evidence",
    uploaded_by: technician.id,
  }));

  const supervisorPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  await upload("project-files", supervisorPath, minimalPdf, "application/pdf", service, {
    generator: "susotech-portal", job_id: jobId, source_photo_ids: [photoOneId, photoTwoId].sort().join(","),
    source_document_ids: documentId, snapshot_hash: snapshotHash,
  });
  await denied("stale photo snapshot cannot replace valid pointer", supervisor.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId, p_storage_path: supervisorPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: false,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
  }));
  const stillFirst = await ok("read pointer after rejected stale confirmation", admin.client.from("jobs")
    .select("delivered_pdf_path").eq("id", jobId).single());
  check(stillFirst.delivered_pdf_path === firstDeliveredPath, "failed regeneration preserves last valid pointer");

  await denied("supervisor cannot regenerate current PDF", supervisor.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId,
    p_storage_path: supervisorPath,
    p_source_photo_ids: [photoTwoId, photoOneId],
    p_source_document_ids: [documentId],
    p_submit: false,
    p_expected_draft_version: draftVersion,
    p_snapshot_hash: snapshotHash,
  }));
  const afterSupervisor = await ok("read pointer after supervisor denial", admin.client.from("jobs")
    .select("delivered_pdf_path").eq("id", jobId).single());
  check(afterSupervisor.delivered_pdf_path === firstDeliveredPath, "supervisor denial preserves the valid pointer");

  const adminPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  await upload("project-files", adminPath, minimalPdf, "application/pdf", service, {
    generator: "susotech-portal", job_id: jobId, source_photo_ids: [photoOneId, photoTwoId].sort().join(","),
    source_document_ids: documentId, snapshot_hash: snapshotHash,
  });
  const adminResult = await ok("admin regenerates current PDF", admin.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId,
    p_storage_path: adminPath,
    p_source_photo_ids: [photoOneId, photoTwoId],
    p_source_document_ids: [documentId],
    p_submit: false,
    p_expected_draft_version: draftVersion,
    p_snapshot_hash: snapshotHash,
  }));
  check(adminResult?.[0]?.previous_storage_path === firstDeliveredPath, "admin RPC returns cleanup candidate");
  const finalJob = await ok("read final pointer", admin.client.from("jobs")
    .select("main_status, delivered_pdf_path, delivered_pdf_generated_by")
    .eq("id", jobId).single());
  check(finalJob.main_status === "enviado_revision", "office regeneration does not invent a state");
  check(finalJob.delivered_pdf_path === adminPath && finalJob.delivered_pdf_generated_by === admin.id, "admin regeneration persisted");
} finally {
  await cleanup();
}

console.log(`PASS delivered PDF runtime checks=${checks}; cleanup=${cleanupPassed ? "PASS" : "FAIL"}`);
