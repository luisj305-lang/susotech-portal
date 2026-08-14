import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
const extraJobIds = [];
let checks = 0;
let cleanupPassed = false;

function check(condition, label, error) {
  if (!condition) throw new Error(`${label} [${error ? `${error.code ?? "error"}: ${error.message ?? "unknown"}` : "assertion"}]`);
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

function postgres(sql) {
  return execFileSync("docker", ["exec", "supabase_db_susotech-portal", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", sql], { encoding: "utf8" }).trim();
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
  if (extraJobIds.length && (await service.from("jobs").delete().in("id", extraJobIds)).error) errors.push("extra jobs");
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
  const helper = await identity("helper", "tecnico");
  await ok("configure helper specialty", admin.client.rpc("set_worker_specialty", {
    p_profile_id: helper.id,
    p_worker_specialty: "ayudante",
  }));
  const inhouseCategory = await ok("read active Inhouse category", admin.client.from("price_categories")
    .select("id").eq("slug", "inhouse").eq("active", true).single());
  await ok("assign technician Inhouse category", admin.client.rpc("set_technician_price_category", {
    p_technician_id: technician.id, p_price_category_id: inhouseCategory.id,
  }));
  await ok("assign helper Inhouse category for immutable legacy fixture", admin.client.rpc("set_technician_price_category", {
    p_technician_id: helper.id, p_price_category_id: inhouseCategory.id,
  }));
  await startShift(technician, "assigned technician");
  await startShift(outsider, "unassigned technician");
  jobId = randomUUID();
  const originalPath = `${jobId}/original.pdf`;
  await ok("create in-progress job", admin.client.from("jobs").insert({
    id: jobId,
    title: `Delivered runtime ${runId}`,
    project_pdf_url: originalPath,
  }));
  await ok("assign technician", admin.client.rpc("assign_jobs_atomic", {
    job_ids: [jobId], new_assignee_type: "technician", new_assignee_id: technician.id,
  }));
  await ok("start assigned job", technician.client.from("jobs")
    .update({ main_status: "en_progreso" }).eq("id", jobId).select("id").single());
  await upload("project-files", originalPath, minimalPdf, "application/pdf");
  const originalHash = createHash("sha256").update(minimalPdf).digest("hex");
  const originalDocument = await ok("register verified original", service.rpc("ensure_job_original_document", {
    p_job_id: jobId, p_storage_path: originalPath, p_original_filename: "original.pdf",
    p_size_bytes: minimalPdf.length, p_file_hash: originalHash, p_page_count: 1,
  }));
  const documentId = originalDocument;
  const technicianCatalog = await ok("read applicable production catalog", technician.client.rpc("list_my_production_catalog"));
  const catalog = technicianCatalog.find((item) => item.unit_rate !== null);
  check(Boolean(catalog?.id), "applicable production catalog contains a rated item");
  const initialized = await ok("initialize complete draft", technician.client.rpc("initialize_job_pdf_draft_v3", {
    p_job_id: jobId, p_source_document_ids: [documentId], p_page_count: 1,
  }));
  const placement = {
    id: randomUUID(), catalogId: catalog.id, page: 1, sourceDocumentId: documentId,
    sourcePage: 1, quantity: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.08,
    arrowTipX: 0.5, arrowTipY: 0.5,
  };
  const textNotes = [{
    page: 1, sourceDocumentId: documentId, sourcePage: 1,
    text: "Instalación — José\nSeñal número 2", x: 0.1, y: 0.2,
    width: 0.4, height: 0.2, fontSizeRatio: 0.02,
  }];
  const draftVersion = await ok("save complete draft", technician.client.rpc("save_job_pdf_draft_v3", {
    p_job_id: jobId, p_expected_version: initialized[0].version, p_placements: [placement], p_text_notes: textNotes,
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

  const allocationIdempotencyKey = randomUUID();
  const submitted = await ok("technician atomically delivers with allocations and notes", technician.client.rpc("confirm_delivered_job_pdf_with_allocations_v3", {
    p_job_id: jobId, p_storage_path: firstDeliveredPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: true,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
    p_text_note_snapshot: textNotes,
    p_allocations: [
      { participantId: technician.id, percentageBasisPoints: 3333 },
      { participantId: helper.id, percentageBasisPoints: 6667 },
    ],
    p_allocation_idempotency_key: allocationIdempotencyKey,
  }));
  check(submitted?.[0]?.delivered_status === "enviado_revision", "submission advances existing state");
  const allocationVersionId = submitted?.[0]?.allocation_version_id;
  check(Boolean(allocationVersionId), "submission creates allocation version atomically");
  const version = await ok("read allocation source snapshot", admin.client.from("job_delivery_allocation_versions")
    .select("source_amount_cents, version, idempotency_key").eq("id", allocationVersionId).single());
  const allocations = await ok("read exact allocation cents", admin.client.from("job_delivery_financial_allocations")
    .select("participant_id, percentage_basis_points, allocated_cents, allocation_order")
    .eq("allocation_version_id", allocationVersionId).order("allocation_order"));
  check(version.version === 1 && version.idempotency_key === allocationIdempotencyKey, "allocation v1 and idempotency persisted");
  check(allocations.length === 2
    && allocations.reduce((sum, row) => sum + Number(row.percentage_basis_points), 0) === 10000
    && allocations.reduce((sum, row) => sum + Number(row.allocated_cents), 0) === Number(version.source_amount_cents),
  "Hamilton allocation preserves exact basis points and cents");
  const initialAnnotations = await ok("read immutable text annotations", technician.client.from("job_pdf_text_annotations")
    .select("id,text").eq("delivery_id", submitted[0].delivery_id));
  check(initialAnnotations.length === textNotes.length && initialAnnotations[0].text === textNotes[0].text,
    "delivery preserves exact multiline accented text snapshot");
  const retried = await ok("same delivery allocation and notes retry is idempotent", technician.client.rpc("confirm_delivered_job_pdf_with_allocations_v3", {
    p_job_id: jobId, p_storage_path: firstDeliveredPath, p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId], p_submit: true,
    p_expected_draft_version: draftVersion, p_snapshot_hash: snapshotHash,
    p_text_note_snapshot: textNotes,
    p_allocations: [
      { participantId: technician.id, percentageBasisPoints: 3333 },
      { participantId: helper.id, percentageBasisPoints: 6667 },
    ],
    p_allocation_idempotency_key: allocationIdempotencyKey,
  }));
  check(retried?.[0]?.allocation_version_id === allocationVersionId, "idempotent retry reuses allocation version");
  const retriedAnnotations = await ok("read annotations after idempotent retry", technician.client.from("job_pdf_text_annotations")
    .select("id").eq("delivery_id", submitted[0].delivery_id));
  check(retriedAnnotations.length === textNotes.length, "idempotent retry never duplicates text annotations");
  const helperOwn = await ok("helper reads own allocation only", helper.client.rpc("list_my_financial_allocations", { p_job_id: jobId }));
  check(helperOwn.length === 1 && helperOwn[0].percentage_basis_points === 6667, "helper receives own read-only financial history");
  const helperJob = await ok("allocation grants helper job read", helper.client.from("jobs").select("id").eq("id", jobId).single());
  check(helperJob.id === jobId, "helper participant can read allocated job");
  const helperMutation = await helper.client.from("jobs")
    .update({ title: "forbidden helper update" }).eq("id", jobId).select("id");
  check(Boolean(helperMutation.error) || helperMutation.data?.length === 0,
    "helper allocation never grants mutation", helperMutation.error);

  postgres(`delete from public.job_delivery_allocation_versions where id = '${allocationVersionId}'::uuid`);
  checks += 1;
  const backfilled = await ok("backfill one unambiguous current delivery", service
    .rpc("backfill_unambiguous_delivery_allocations"));
  check(backfilled === 1, "unambiguous delivery receives allocation v1");
  const backfillRetry = await ok("backfill retry is idempotent", service
    .rpc("backfill_unambiguous_delivery_allocations"));
  check(backfillRetry === 0, "backfill retry inserts nothing");
  const backfilledVersion = await ok("read backfilled allocation", admin.client
    .from("job_delivery_allocation_versions")
    .select("id, version, source_amount_cents, request_payload")
    .eq("delivery_id", submitted[0].delivery_id).single());
  const backfilledLines = await ok("read backfilled participant", admin.client
    .from("job_delivery_financial_allocations")
    .select("participant_id, percentage_basis_points, allocated_cents")
    .eq("allocation_version_id", backfilledVersion.id));
  check(backfilledVersion.version === 1 && backfilledLines.length === 1
    && backfilledLines[0].participant_id === technician.id
    && backfilledLines[0].percentage_basis_points === 10000
    && Number(backfilledLines[0].allocated_cents) === Number(backfilledVersion.source_amount_cents),
  "backfill snapshots exact 100-percent participant and cents");

  const ambiguousJobId = randomUUID();
  const ambiguousDeliveryId = randomUUID();
  extraJobIds.push(ambiguousJobId);
  await ok("create no-line manual-review job", service.from("jobs").insert({
    id: ambiguousJobId,
    title: `No-line allocation review ${runId}`,
  }));
  await ok("create no-line current submitted delivery", service.from("job_deliveries").insert({
    id: ambiguousDeliveryId,
    job_id: ambiguousJobId,
    storage_path: `${ambiguousJobId}/delivered/${randomUUID()}.pdf`,
    delivery_kind: "legacy",
    delivered_by: technician.id,
    submitted: true,
  }));
  postgres(`select set_config('request.jwt.claims', '{"sub":"${technician.id}","role":"authenticated"}', true); select set_config('app.job_pdf_deletion', '${technician.id}', true); update public.jobs set current_delivery_id = '${ambiguousDeliveryId}'::uuid where id = '${ambiguousJobId}'::uuid`);
  checks += 1;
  const excludedBackfill = await ok("rerun backfill with no-line delivery", service
    .rpc("backfill_unambiguous_delivery_allocations"));
  check(excludedBackfill === 0, "no-line delivery remains manual review");
  const excludedVersions = await ok("verify no-line delivery has no allocation", admin.client
    .from("job_delivery_allocation_versions").select("id").eq("delivery_id", ambiguousDeliveryId));
  check(excludedVersions.length === 0, "ambiguous no-line delivery is untouched");

  const replacementKey = randomUUID();
  const replacementId = await ok("replace current allocation with v2", technician.client
    .rpc("replace_delivery_financial_allocation", {
      p_delivery_id: submitted[0].delivery_id,
      p_expected_version: 1,
      p_allocations: [
        { participantId: technician.id, percentageBasisPoints: 5000 },
        { participantId: helper.id, percentageBasisPoints: 5000 },
      ],
      p_idempotency_key: replacementKey,
      p_reason: "Runtime replacement",
    }));
  const replacementRetry = await ok("replacement retry is idempotent", technician.client
    .rpc("replace_delivery_financial_allocation", {
      p_delivery_id: submitted[0].delivery_id,
      p_expected_version: 1,
      p_allocations: [
        { participantId: technician.id, percentageBasisPoints: 5000 },
        { participantId: helper.id, percentageBasisPoints: 5000 },
      ],
      p_idempotency_key: replacementKey,
      p_reason: "Runtime replacement",
    }));
  check(replacementRetry === replacementId, "replacement retry does not duplicate version");
  await denied("stale expected allocation version is rejected", technician.client
    .rpc("replace_delivery_financial_allocation", {
      p_delivery_id: submitted[0].delivery_id,
      p_expected_version: 1,
      p_allocations: [{ participantId: technician.id, percentageBasisPoints: 10000 }],
      p_idempotency_key: randomUUID(),
      p_reason: "Stale runtime replacement",
    }));
  const versionHistory = await ok("read replacement version history", admin.client
    .from("job_delivery_allocation_versions")
    .select("id, version, source_amount_cents, superseded_at, voided_at")
    .eq("delivery_id", submitted[0].delivery_id).order("version"));
  const replacementLines = await ok("read replacement cents", admin.client
    .from("job_delivery_financial_allocations").select("allocated_cents, percentage_basis_points")
    .eq("allocation_version_id", replacementId));
  check(versionHistory.length === 2 && versionHistory[0].version === 1
    && Boolean(versionHistory[0].superseded_at) && versionHistory[1].version === 2
    && !versionHistory[1].superseded_at && !versionHistory[1].voided_at,
  "v1 superseded and exactly one v2 remains current");
  check(replacementLines.reduce((sum, row) => sum + Number(row.allocated_cents), 0)
    === Number(versionHistory[1].source_amount_cents)
    && replacementLines.reduce((sum, row) => sum + Number(row.percentage_basis_points), 0) === 10000,
  "replacement preserves exact cents and basis points");
  const productionBefore = await service.from("job_delivery_production_lines")
    .select("id", { count: "exact", head: true }).eq("delivery_id", submitted[0].delivery_id);
  check(!productionBefore.error && Number(productionBefore.count) > 0,
    "count immutable production lines", productionBefore.error);
  const productionLineCount = Number(productionBefore.count);
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
  const deletedPhoto = await ok("admin soft-deletes later evidence", admin.client.rpc("delete_job_photo_audited", {
    p_photo_id: photoTwoId,
  }));
  check(deletedPhoto?.[0]?.object_name === photoTwoPath, "photo deletion returns the private cleanup target");
  await ok("remove soft-deleted private evidence object", service.storage.from("job-evidence").remove([photoTwoPath]));
  const auditVisiblePhotos = await ok("admin retains deleted evidence audit visibility", admin.client
    .from("job_photos").select("id, deleted_at").eq("job_id", jobId).order("created_at"));
  check(auditVisiblePhotos.length === 2 && auditVisiblePhotos.some((photo) => photo.id === photoTwoId && photo.deleted_at),
    "soft-deleted evidence remains auditable to admin");
  const activePhotos = await ok("PDF composition query excludes deleted evidence", admin.client
    .from("job_photos").select("id").eq("job_id", jobId).is("deleted_at", null).order("created_at"));
  check(activePhotos.length === 1 && activePhotos[0].id === photoOneId,
    "only active evidence remains eligible for PDF regeneration");
  const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const currentFinancialReport = await ok("current allocation appears in office report", admin.client
    .rpc("get_financial_allocation_report", { p_start_date: reportDate, p_end_date: reportDate }));
  check(currentFinancialReport.filter((row) => row.job_id === jobId).length === 2,
    "current v2 report contains each participant once");

  const adminPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  await upload("project-files", adminPath, minimalPdf, "application/pdf", service, {
    generator: "susotech-portal", job_id: jobId, source_photo_ids: photoOneId,
    source_document_ids: documentId, snapshot_hash: snapshotHash,
  });
  const adminResult = await ok("admin regenerates after evidence deletion", admin.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId,
    p_storage_path: adminPath,
    p_source_photo_ids: [photoOneId],
    p_source_document_ids: [documentId],
    p_submit: false,
    p_expected_draft_version: draftVersion,
    p_snapshot_hash: snapshotHash,
  }));
  check(adminResult?.[0]?.previous_storage_path === firstDeliveredPath, "admin RPC returns cleanup candidate");
  const finalJob = await ok("read final pointer", admin.client.from("jobs")
    .select("main_status, delivered_pdf_path, delivered_pdf_generated_by, delivered_pdf_source_photo_ids")
    .eq("id", jobId).single());
  check(finalJob.main_status === "enviado_revision", "office regeneration does not invent a state");
  check(finalJob.delivered_pdf_path === adminPath && finalJob.delivered_pdf_generated_by === admin.id, "admin regeneration persisted");
  check(finalJob.delivered_pdf_source_photo_ids?.length === 1
    && finalJob.delivered_pdf_source_photo_ids[0] === photoOneId,
  "regenerated PDF snapshot excludes deleted evidence");

  await ok("office rejects submitted delivery", admin.client.from("jobs")
    .update({ main_status: "en_progreso", comments: "Runtime rejection" }).eq("id", jobId).select("id").single());
  const rejectedVersions = await ok("read allocation history after rejection", admin.client
    .from("job_delivery_allocation_versions")
    .select("id, version, superseded_at, voided_at")
    .eq("delivery_id", submitted[0].delivery_id).order("version"));
  check(rejectedVersions.length === 2 && Boolean(rejectedVersions[0].superseded_at)
    && Boolean(rejectedVersions[1].voided_at),
  "rejection voids current v2 while preserving immutable v1/v2 history");
  const reportAfterRejection = await ok("read report after rejection", admin.client
    .rpc("get_financial_allocation_report", { p_start_date: reportDate, p_end_date: reportDate }));
  check(reportAfterRejection.every((row) => row.job_id !== jobId),
    "voided delivery leaves current financial reports");
  const productionAfter = await service.from("job_delivery_production_lines")
    .select("id", { count: "exact", head: true }).eq("delivery_id", submitted[0].delivery_id);
  check(!productionAfter.error && Number(productionAfter.count) === productionLineCount,
    "replace and rejection never duplicate operational production lines", productionAfter.error);
  const technicianHistory = await ok("technician retains immutable allocation history", technician.client
    .rpc("list_my_financial_allocations", { p_job_id: jobId }));
  check(technicianHistory.length === 2
    && technicianHistory.some((row) => row.state === "superseded")
    && technicianHistory.some((row) => row.state === "voided"),
  "participant can read superseded and voided history");
  const helperDeliveryId = randomUUID();
  const sourceLine = await ok("read production lineage for helper exclusion fixture", service
    .from("job_delivery_production_lines")
    .select("source_annotation_id,code,quantity,unit_snapshot,unit_rate_snapshot,amount_snapshot")
    .eq("delivery_id", submitted[0].delivery_id).limit(1).single());
  await ok("create helper-delivered legacy current candidate", service.from("job_deliveries").insert({
    id: helperDeliveryId,
    job_id: jobId,
    storage_path: `${jobId}/delivered/${randomUUID()}.pdf`,
    delivery_kind: "legacy",
    delivered_by: helper.id,
    submitted: true,
    source_annotation_ids: [sourceLine.source_annotation_id],
  }));
  await ok("create helper-credited immutable line", service.from("job_delivery_production_lines").insert({
    delivery_id: helperDeliveryId,
    job_id: jobId,
    source_annotation_id: sourceLine.source_annotation_id,
    credited_technician_id: helper.id,
    code: sourceLine.code,
    quantity: sourceLine.quantity,
    unit_snapshot: sourceLine.unit_snapshot,
    unit_rate_snapshot: sourceLine.unit_rate_snapshot,
    amount_snapshot: sourceLine.amount_snapshot,
    credited_at: new Date().toISOString(),
  }));
  postgres(`select set_config('request.jwt.claims', '{"sub":"${technician.id}","role":"authenticated"}', true); select set_config('app.job_pdf_deletion', '${technician.id}', true); update public.jobs set current_delivery_id = '${helperDeliveryId}'::uuid where id = '${jobId}'::uuid`);
  checks += 1;
  const helperBackfill = await ok("run backfill against helper-delivered legacy candidate", service
    .rpc("backfill_unambiguous_delivery_allocations"));
  check(helperBackfill === 0, "helper-delivered legacy work remains manual review");
  const helperVersions = await ok("verify helper-delivered candidate has no allocation", admin.client
    .from("job_delivery_allocation_versions").select("id").eq("delivery_id", helperDeliveryId));
  check(helperVersions.length === 0, "helper can participate but is never inferred as primary deliverer");
} finally {
  await cleanup();
}

console.log(`PASS delivered PDF runtime checks=${checks}; cleanup=${cleanupPassed ? "PASS" : "FAIL"}`);
