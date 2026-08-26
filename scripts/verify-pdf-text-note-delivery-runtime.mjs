import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const raw of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/u)) {
  const line = raw.trim(); const split = line.indexOf("=");
  if (!line || line.startsWith("#") || split < 1 || process.env[line.slice(0, split)]) continue;
  process.env[line.slice(0, split)] = line.slice(split + 1).trim().replace(/^(['"])(.*)\1$/u, "$2");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !serviceKey) throw new Error("Missing Supabase environment variables");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
let userId; let adminId; let jobId; const objects = { "project-files": [], "job-evidence": [] };
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const ok = async (label, promise) => { const result = await promise; if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
const upload = async (bucket, path, bytes, contentType, metadata) => {
  await ok(`upload ${path}`, service.storage.from(bucket).upload(path, bytes, { contentType, metadata }));
  objects[bucket].push(path);
};
const minimalPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=", "base64");

try {
  const created = await ok("create technician", service.auth.admin.createUser({
    email: `pdf-note-delivery-${randomUUID()}@example.com`, password, email_confirm: true,
  }));
  userId = created.user.id;
  await ok("configure technician", service.from("profiles").update({ role: "tecnico", is_active: true }).eq("id", userId));
  const client = createClient(url, anon, options);
  await ok("sign in", client.auth.signInWithPassword({ email: created.user.email, password }));
  const adminCreated = await ok("create admin", service.auth.admin.createUser({
    email: `pdf-note-admin-${randomUUID()}@example.com`, password, email_confirm: true,
  }));
  adminId = adminCreated.user.id;
  await ok("configure admin", service.from("profiles").update({ role: "admin", is_active: true }).eq("id", adminId));
  const admin = createClient(url, anon, options);
  await ok("sign in admin", admin.auth.signInWithPassword({ email: adminCreated.user.email, password }));
  const category = await ok("read category", admin.from("price_categories").select("id").eq("slug", "inhouse").single());
  await ok("set category", admin.rpc("set_technician_price_category", { p_technician_id: userId, p_price_category_id: category.id }));
  await ok("start shift", client.rpc("start_technician_shift", { p_no_fuel_today: true, p_fuel_amount: 0, p_fuel_photo_path: null }));
  jobId = randomUUID(); const originalPath = `${jobId}/original.pdf`;
  await ok("create job", service.from("jobs").insert({ id: jobId, title: "PDF note delivery runtime", project_pdf_url: originalPath }));
  await ok("assign", admin.rpc("assign_jobs_atomic", { job_ids: [jobId], new_assignee_type: "technician", new_assignee_id: userId }));
  await upload("project-files", originalPath, minimalPdf, "application/pdf");
  const documentId = await ok("register original", service.rpc("ensure_job_original_document", {
    p_job_id: jobId, p_storage_path: originalPath, p_original_filename: "original.pdf",
    p_size_bytes: minimalPdf.length, p_file_hash: createHash("sha256").update(minimalPdf).digest("hex"), p_page_count: 1,
  }));
  const catalog = (await ok("catalog", client.rpc("list_my_production_catalog"))).find((item) => item.unit_rate !== null);
  if (!catalog) throw new Error("No rated catalog item");
  const initialized = await ok("initialize v3", client.rpc("initialize_job_pdf_draft_v3", { p_job_id: jobId, p_source_document_ids: [documentId], p_page_count: 1 }));
  const placement = { id: randomUUID(), catalogId: catalog.id, page: 1, sourceDocumentId: documentId, sourcePage: 1, quantity: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.08, arrowTipX: 0.5, arrowTipY: 0.5 };
  const notes = [{ page: 1, sourceDocumentId: documentId, sourcePage: 1, text: "Instalación — José\nSeñal número 2", x: 0.1, y: 0.2, width: 0.4, height: 0.2, fontSizeRatio: 0.02, arrowTipX: 0.6, arrowTipY: 0.4 }];
  const version = await ok("save v3", client.rpc("save_job_pdf_draft_v3", { p_job_id: jobId, p_expected_version: initialized[0].version, p_placements: [placement], p_text_notes: notes }));
  const photoId = randomUUID(); const photoPath = `${jobId}/${randomUUID()}.png`;
  await upload("job-evidence", photoPath, tinyPng, "image/png");
  await ok("register evidence", client.from("job_photos").insert({ id: photoId, job_id: jobId, storage_path: photoPath, photo_type: "evidence", uploaded_by: userId }));
  const deliveredPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  const snapshotHash = createHash("sha256").update(JSON.stringify([placement])).digest("hex");
  await upload("project-files", deliveredPath, minimalPdf, "application/pdf", { generator: "susotech-portal", job_id: jobId, source_photo_ids: photoId, source_document_ids: documentId, snapshot_hash: snapshotHash });
  const key = randomUUID();
  const args = { p_job_id: jobId, p_storage_path: deliveredPath, p_source_photo_ids: [photoId], p_source_document_ids: [documentId], p_submit: true, p_expected_draft_version: version, p_snapshot_hash: snapshotHash, p_text_note_snapshot: notes, p_allocations: [{ participantId: userId, percentageBasisPoints: 10000 }], p_allocation_idempotency_key: key };
  const first = await ok("confirm v3", client.rpc("confirm_delivered_job_pdf_with_allocations_v3", args));
  const before = await ok("read annotations", client.from("job_pdf_text_annotations").select("id,text").eq("delivery_id", first[0].delivery_id));
  if (before.length !== 1 || before[0].text !== notes[0].text) throw new Error("Exact note snapshot was not persisted");
  const retry = await ok("retry v3", client.rpc("confirm_delivered_job_pdf_with_allocations_v3", args));
  const after = await ok("read annotations after retry", client.from("job_pdf_text_annotations").select("id").eq("delivery_id", first[0].delivery_id));
  if (retry[0].allocation_version_id !== first[0].allocation_version_id || after.length !== before.length) throw new Error("Retry duplicated delivery state");
  const regeneratedPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  await upload("project-files", regeneratedPath, minimalPdf, "application/pdf", { generator: "susotech-portal", job_id: jobId, source_photo_ids: photoId, source_document_ids: documentId, snapshot_hash: snapshotHash });
  const regenerated = await ok("admin regenerate v3", admin.rpc("confirm_delivered_job_pdf_complete_v3", {
    p_job_id: jobId, p_storage_path: regeneratedPath, p_source_photo_ids: [photoId],
    p_source_document_ids: [documentId], p_submit: false, p_expected_draft_version: version,
    p_snapshot_hash: snapshotHash, p_text_note_snapshot: notes,
  }));
  const regeneratedNotes = await ok("read regenerated note", admin.from("job_pdf_text_annotations").select("text").eq("delivery_id", regenerated[0].delivery_id));
  if (regeneratedNotes.length !== 1 || regeneratedNotes[0].text !== notes[0].text) throw new Error("Admin regeneration lost note snapshot");
  console.log("[pdf-text-note-delivery-runtime] PASS exact accented multiline snapshot; allocation/annotation retry idempotent; Admin regeneration preserved notes");
} finally {
  for (const [bucket, paths] of Object.entries(objects)) if (paths.length) await service.storage.from(bucket).remove(paths);
  if (jobId) await service.from("jobs").delete().eq("id", jobId);
  if (userId) { await service.from("technician_shifts").delete().eq("technician_id", userId); await service.auth.admin.deleteUser(userId); }
  if (adminId) await service.auth.admin.deleteUser(adminId);
}
