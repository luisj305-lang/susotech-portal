import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";

const url = process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321";
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321$/u.test(url)) {
  throw new Error("This harness only runs against the isolated local Supabase stack.");
}
const anon = process.env.SUPABASE_LOCAL_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const password = "Valid-local-password-123!";
const runId = randomUUID();
const ids = { admin: randomUUID(), supervisor: randomUUID(), tech: randomUUID(), job: randomUUID(), crew: randomUUID(), photo: randomUUID() };
const paths = [];

async function createActor(id, role) {
  const email = `${role}-${runId}@example.test`;
  const created = await service.auth.admin.createUser({ id, email, password, email_confirm: true });
  assert.ifError(created.error);
  const profile = await service.from("profiles").update({ role, full_name: `Runtime ${role}`, is_active: true }).eq("id", id).select("id").single();
  assert.ifError(profile.error);
  const client = createClient(url, anon, options);
  const signed = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signed.error);
  return client;
}

async function makePdf(label) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText(label, { x: 48, y: 730, size: 18 });
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function upload(bucket, path, bytes, contentType, metadata = {}) {
  paths.push({ bucket, path });
  const result = await service.storage.from(bucket).upload(path, bytes, { contentType, metadata, upsert: false });
  assert.ifError(result.error);
}

async function cleanup() {
  for (const bucket of ["project-files", "job-evidence"]) {
    const names = paths.filter((item) => item.bucket === bucket).map((item) => item.path);
    if (names.length) await service.storage.from(bucket).remove(names);
  }
  await service.from("technician_shifts").delete().eq("technician_id", ids.tech);
  await service.from("job_photo_deletion_events").delete().eq("job_id", ids.job);
  await service.from("job_archive_events").delete().eq("job_id", ids.job);
  const deliveries = await service.from("job_deliveries").select("id").eq("job_id", ids.job);
  if (deliveries.data?.length) await service.from("job_delivery_production_lines").delete().in("delivery_id", deliveries.data.map((item) => item.id));
  await service.from("job_pdf_annotations").delete().eq("job_id", ids.job);
  await service.from("job_pdf_delivery_versions").delete().eq("job_id", ids.job);
  await service.from("job_pdf_drafts").delete().eq("job_id", ids.job);
  await service.from("job_photos").delete().eq("job_id", ids.job);
  await service.from("job_assignments").delete().eq("job_id", ids.job);
  await service.from("jobs").update({ current_delivery_id: null }).eq("id", ids.job);
  await service.from("job_documents").delete().eq("job_id", ids.job);
  await service.from("jobs").delete().eq("id", ids.job);
  await service.from("job_deliveries").delete().eq("job_id", ids.job);
  await service.from("crew_members").delete().eq("crew_id", ids.crew);
  await service.from("crews").delete().eq("id", ids.crew);
  await service.from("job_deletion_cleanup_queue").delete().eq("job_id", ids.job);
  for (const id of [ids.tech, ids.supervisor, ids.admin]) await service.auth.admin.deleteUser(id);
}

try {
  const [admin, supervisor, tech] = await Promise.all([
    createActor(ids.admin, "admin"), createActor(ids.supervisor, "supervisor"), createActor(ids.tech, "tecnico"),
  ]);
  assert.ifError((await service.from("crews").insert({ id: ids.crew, name: `Runtime crew ${runId}`, lead_technician_id: ids.tech })).error);

  const original = await makePdf("ORIGINAL SOURCE");
  const originalPath = `${ids.job}/original.pdf`;
  await upload("project-files", originalPath, original, "application/pdf");
  assert.ifError((await service.from("jobs").insert({ id: ids.job, title: `Runtime major update ${runId}`, main_status: "en_progreso", project_pdf_url: originalPath })).error);
  assert.ifError((await admin.rpc("assign_jobs_atomic", { job_ids: [ids.job], new_assignee_type: "technician", new_assignee_id: ids.tech })).error);
  const originalHash = createHash("sha256").update(original).digest("hex");
  const originalDocument = await service.rpc("ensure_job_original_document", {
    p_job_id: ids.job, p_storage_path: originalPath, p_original_filename: "original.pdf",
    p_size_bytes: original.length, p_file_hash: originalHash, p_page_count: 1,
  });
  assert.ifError(originalDocument.error);

  const additional = await makePdf("ADDITIONAL SOURCE");
  const additionalHash = createHash("sha256").update(additional).digest("hex");
  const prepared = await admin.rpc("prepare_job_document_v2", {
    p_job_id: ids.job, p_display_name: "additional.pdf", p_mime_type: "application/pdf",
    p_size_bytes: additional.length, p_file_hash: additionalHash,
  });
  assert.ifError(prepared.error);
  await upload("project-files", prepared.data[0].storage_path, additional, "application/pdf");
  assert.ifError((await admin.rpc("confirm_job_document_verified", {
    p_document_id: prepared.data[0].document_id, p_file_hash: additionalHash, p_page_count: 1,
  })).error);
  const documents = await service.from("job_documents").select("id,position,document_type,file_hash,page_count").eq("job_id", ids.job).order("position");
  assert.ifError(documents.error);
  assert.deepEqual(documents.data.map((item) => item.document_type), ["original", "additional"]);
  assert.deepEqual(documents.data.map((item) => item.position), [0, 1]);
  assert.ok(documents.data.every((item) => item.file_hash && item.page_count === 1));

  assert.ifError((await tech.rpc("start_technician_shift", { p_no_fuel_today: true, p_fuel_amount: 0, p_fuel_photo_path: null })).error);
  const documentIds = documents.data.map((item) => item.id);
  const initialized = await tech.rpc("initialize_job_pdf_draft_v2", { p_job_id: ids.job, p_source_document_ids: documentIds, p_page_count: 2 });
  assert.ifError(initialized.error);
  const catalog = await service.from("production_code_catalog").select("id,code,unit").eq("is_active", true).order("code").limit(1).single();
  assert.ifError(catalog.error);
  const quantity = 12;
  const placement = {
    id: randomUUID(), catalogId: catalog.data.id, page: 2,
    sourceDocumentId: documentIds[1], sourcePage: 1, quantity,
    x: 0.18, y: 0.2, width: 0.16, height: 0.06,
    arrowTipX: 0.55, arrowTipY: 0.36,
  };
  const saved = await tech.rpc("save_job_pdf_draft_v2", { p_job_id: ids.job, p_expected_version: initialized.data[0].version, p_placements: [placement] });
  assert.ifError(saved.error);

  const evidence = new TextEncoder().encode("runtime-evidence");
  const evidencePath = `${ids.job}/${randomUUID()}.jpg`;
  await upload("job-evidence", evidencePath, evidence, "image/jpeg");
  assert.ifError((await service.from("job_photos").insert({ id: ids.photo, job_id: ids.job, storage_path: evidencePath, uploaded_by: ids.tech, photo_type: "evidence" })).error);

  async function confirmDelivery(client, submit, expectedVersion, nextQuantity, suffix) {
    const currentPlacement = { ...placement, quantity: nextQuantity };
    if (expectedVersion !== saved.data) {
      const changed = await tech.rpc("save_job_pdf_draft_v2", { p_job_id: ids.job, p_expected_version: expectedVersion - 1, p_placements: [currentPlacement] });
      assert.ifError(changed.error);
      assert.equal(changed.data, expectedVersion);
    }
    const delivered = await makePdf(`DELIVERED ${suffix}`);
    const deliveredPath = `${ids.job}/delivered/${randomUUID()}.pdf`;
    const snapshotHash = createHash("sha256").update(JSON.stringify([currentPlacement])).digest("hex");
    await upload("project-files", deliveredPath, delivered, "application/pdf", {
      generator: "susotech-portal", job_id: ids.job, source_photo_ids: ids.photo,
      source_document_ids: documentIds.join(","), snapshot_hash: snapshotHash,
    });
    const result = await client.rpc("confirm_delivered_job_pdf_complete", {
      p_job_id: ids.job, p_storage_path: deliveredPath, p_source_photo_ids: [ids.photo],
      p_source_document_ids: documentIds, p_submit: submit,
      p_expected_draft_version: expectedVersion, p_snapshot_hash: snapshotHash,
    });
    assert.ifError(result.error);
    return result.data[0];
  }

  const first = await confirmDelivery(tech, true, saved.data, quantity, "FIRST");
  assert.equal(first.delivered_status, "enviado_revision");
  let lines = await service.from("job_delivery_production_lines").select("quantity,credited_technician_id").eq("job_id", ids.job);
  assert.equal(lines.data.length, 1);
  assert.equal(lines.data[0].credited_technician_id, ids.tech);

  const regenerated = await confirmDelivery(admin, false, saved.data, quantity, "REGENERATED");
  assert.equal(regenerated.delivered_status, "enviado_revision");
  lines = await service.from("job_delivery_production_lines").select("id").eq("job_id", ids.job);
  assert.equal(lines.data.length, 1, "admin regeneration must not add production credit");

  assert.ifError((await admin.from("jobs").update({ main_status: "en_progreso", comments: "Runtime correction" }).eq("id", ids.job)).error);
  const activeSubmission = await service.from("job_deliveries").select("id").eq("job_id", ids.job).eq("submitted", true).is("superseded_at", null);
  assert.equal(activeSubmission.data.length, 0, "rejection supersedes the prior production event");
  const second = await confirmDelivery(tech, true, saved.data + 1, 20, "RESUBMITTED");
  assert.equal(second.delivered_status, "enviado_revision");
  const currentLines = await service.from("job_delivery_production_lines").select("quantity,job_deliveries!inner(superseded_at)").eq("job_id", ids.job).is("job_deliveries.superseded_at", null);
  assert.equal(currentLines.data.length, 1);
  assert.equal(Number(currentLines.data[0].quantity), 20);

  const dashboard = await supervisor.rpc("get_worker_operations_dashboard", { p_reference_at: new Date().toISOString() });
  assert.ifError(dashboard.error);
  const technicianRow = dashboard.data.find((row) => row.technician_id === ids.tech);
  assert.equal(Number(technicianRow.weekly_production), 20);
  assert.equal(Number(technicianRow.weekly_delivered_jobs), 1);
  assert.equal(Number(technicianRow.weekly_fuel_amount), 0);
  assert.ok(technicianRow.crew_names.includes(`Runtime crew ${runId}`));
  const spring = await supervisor.rpc("get_worker_operations_dashboard", { p_reference_at: "2026-03-08T12:00:00Z" });
  const fall = await supervisor.rpc("get_worker_operations_dashboard", { p_reference_at: "2026-11-01T12:00:00Z" });
  assert.ifError(spring.error); assert.ifError(fall.error);
  assert.equal((new Date(spring.data[0].week_end_exclusive_at) - new Date(spring.data[0].week_start_at)) / 3_600_000, 167);
  assert.equal((new Date(fall.data[0].week_end_exclusive_at) - new Date(fall.data[0].week_start_at)) / 3_600_000, 169);
  const friday = await supervisor.rpc("get_worker_operations_dashboard", { p_reference_at: "2026-08-14T04:00:00Z" });
  assert.equal(friday.data[0].week_start_at, "2026-08-14T04:00:00+00:00");

  const deniedDelete = await supervisor.rpc("delete_job_photo_audited", { p_photo_id: ids.photo });
  assert.ok(deniedDelete.error, "supervisor cannot delete evidence");
  const deletion = await admin.rpc("delete_job_photo_audited", { p_photo_id: ids.photo });
  assert.ifError(deletion.error);
  assert.equal(deletion.data[0].object_name, evidencePath);
  const hiddenPhoto = await tech.from("job_photos").select("id").eq("id", ids.photo);
  assert.equal(hiddenPhoto.data.length, 0);
  assert.ifError((await admin.storage.from("job-evidence").remove([evidencePath])).error);
  assert.ifError((await admin.rpc("finish_job_deletion_cleanup", { p_completed_ids: [deletion.data[0].queue_id], p_failed_ids: [], p_error: null })).error);
  const audit = await service.from("job_photo_deletion_events").select("deleted_by").eq("photo_id", ids.photo).single();
  assert.equal(audit.data.deleted_by, ids.admin);

  assert.ifError((await admin.rpc("set_job_archived_v2", { p_job_id: ids.job, p_archived: true, p_reason_code: "duplicate_job", p_notes: "Runtime audit" })).error);
  const archived = await service.from("jobs").select("archive_reason_code,archive_notes").eq("id", ids.job).single();
  assert.deepEqual(archived.data, { archive_reason_code: "duplicate_job", archive_notes: "Runtime audit" });
  assert.ifError((await admin.rpc("set_job_archived_v2", { p_job_id: ids.job, p_archived: false, p_reason_code: null, p_notes: null })).error);
  const archiveEvents = await service.from("job_archive_events").select("event_type,reason_code,is_legacy").eq("job_id", ids.job).order("occurred_at");
  assert.deepEqual(archiveEvents.data.slice(-2).map((item) => item.event_type), ["archived", "restored"]);
  assert.equal(archiveEvents.data.at(-2).reason_code, "duplicate_job");
  assert.equal(archiveEvents.data.at(-2).is_legacy, false);
  const officeArchiveEvents = await supervisor.rpc("list_job_archive_events_for_office", { p_job_id: ids.job });
  assert.ifError(officeArchiveEvents.error);
  assert.deepEqual(officeArchiveEvents.data.slice(0, 2).map((item) => item.event_type), ["restored", "archived"]);
  assert.equal(officeArchiveEvents.data[1].reason_code, "duplicate_job");
  assert.equal(officeArchiveEvents.data[1].actor_name, "Runtime admin");

  console.log(JSON.stringify({ result: "PASS", documents: documents.data.length, production: 20, deliveries: 1, archiveEvents: 2, photoAudit: true }));
} finally {
  await cleanup();
}
