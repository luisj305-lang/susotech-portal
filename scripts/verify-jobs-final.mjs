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
if (!url || !anonKey || !serviceKey) throw new Error("Missing required Supabase server environment variables");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options); // Fixture setup/cleanup only.
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const users = [];
const jobs = [];
const projectObjects = [];
const evidenceObjects = [];
const deliveryContexts = new Map();
let adminClient;
let checks = 0;
let cleanupPassed = false;

function check(condition, label, error) {
  if (!condition) {
    const detail = error?.message ? `: ${error.message}` : "";
    throw new Error(`${label} [${error?.code ?? error?.status ?? "assertion"}]${detail}`);
  }
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
  check(Boolean(result.error) || empty || result.data === null, label);
}

async function identity(label, role, isActive = true) {
  const email = `jobs-final-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  users.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: isActive, full_name: `Final ${label}` }).eq("id", id));
  const client = createClient(url, anonKey, options);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function startShift(identity, label) {
  const rows = await ok(`${label} starts work shift`, identity.client.rpc("start_technician_shift", {
    p_no_fuel_today: true,
    p_fuel_amount: 0,
    p_fuel_photo_path: null,
  }));
  check(rows?.length === 1, `${label} shift created`);
}

async function createJob(client, title) {
  const row = await ok(`create job ${title.slice(0, 12)}`, client.from("jobs").insert({ title }).select("id, main_status, category").single());
  jobs.push(row.id);
  check(row.main_status === "sin_asignar" && row.category === "categoria_1", "job defaults applied");
  return row.id;
}

async function assign(client, jobIds, assigneeId, assigneeType = "technician") {
  return ok("assign jobs", client.rpc("assign_jobs_atomic", {
    job_ids: jobIds, new_assignee_type: assigneeType, new_assignee_id: assigneeId,
  }));
}

async function status(client, jobId, value, extra = {}) {
  if (value === "enviado_revision") throw new Error("Use deliver() for submitted jobs");
  return ok(`transition ${value}`, client.from("jobs").update({ main_status: value, ...extra }).eq("id", jobId)
    .select("main_status, incident, submitted_at, approved_at, paid_at").single());
}

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=", "base64");
const minimalPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function prepareEvidence(client, jobId, technicianId) {
  const id = randomUUID();
  const path = `${jobId}/${randomUUID()}.png`;
  await ok("upload delivery evidence", client.storage.from("job-evidence").upload(path, tinyPng, {
    contentType: "image/png", upsert: false,
  }));
  evidenceObjects.push(path);
  await ok("confirm delivery evidence", client.from("job_photos").insert({
    id, job_id: jobId, storage_path: path, photo_type: "evidence", uploaded_by: technicianId,
  }));
  return id;
}

async function deliver(client, jobId, sourcePhotoIds, label) {
  let context = deliveryContexts.get(jobId);
  if (!context) {
    const originalPath = `${jobId}/original-runtime.pdf`;
    await ok("upload original delivery fixture", service.storage.from("project-files").upload(originalPath, minimalPdf, {
      contentType: "application/pdf", upsert: false,
    }));
    projectObjects.push(originalPath);
    await ok("attach original delivery fixture", adminClient.from("jobs").update({ project_pdf_url: originalPath }).eq("id", jobId));
    const originalHash = createHash("sha256").update(minimalPdf).digest("hex");
    const original = await ok("register original delivery fixture", service.rpc("ensure_job_original_document", {
      p_job_id: jobId, p_storage_path: originalPath, p_original_filename: "original-runtime.pdf",
      p_size_bytes: minimalPdf.length, p_file_hash: originalHash, p_page_count: 1,
    }));
    const catalog = await ok("read delivery catalog fixture", service.from("production_code_catalog").select("id").limit(1).single());
    const sourceDocumentId = original;
    const initialized = await ok("initialize delivery draft", client.rpc("initialize_job_pdf_draft_v2", {
      p_job_id: jobId, p_source_document_ids: [sourceDocumentId], p_page_count: 1,
    }));
    const placement = {
      id: randomUUID(), catalogId: catalog.id, page: 1, sourceDocumentId, sourcePage: 1,
      quantity: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.08,
      arrowTipX: 0.5, arrowTipY: 0.5,
    };
    const draftVersion = await ok("save delivery draft", client.rpc("save_job_pdf_draft_v2", {
      p_job_id: jobId, p_expected_version: initialized[0].version, p_placements: [placement],
    }));
    context = {
      sourceDocumentId,
      draftVersion,
      snapshotHash: createHash("sha256").update(JSON.stringify([placement])).digest("hex"),
    };
    deliveryContexts.set(jobId, context);
  }
  const path = `${jobId}/delivered/${randomUUID()}.pdf`;
  const sortedPhotoIds = [...sourcePhotoIds].sort();
  await ok(`upload ${label} delivered PDF`, service.storage.from("project-files").upload(path, minimalPdf, {
    contentType: "application/pdf",
    upsert: false,
    metadata: {
      generator: "susotech-portal",
      job_id: jobId,
      source_photo_ids: sortedPhotoIds.join(","),
      source_document_ids: context.sourceDocumentId,
      snapshot_hash: context.snapshotHash,
    },
  }));
  projectObjects.push(path);
  const delivered = await ok(label, client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: jobId,
    p_storage_path: path,
    p_source_photo_ids: sourcePhotoIds,
    p_source_document_ids: [context.sourceDocumentId],
    p_submit: true,
    p_expected_draft_version: context.draftVersion,
    p_snapshot_hash: context.snapshotHash,
  }));
  check(delivered?.[0]?.delivered_status === "enviado_revision", `${label} advances through atomic delivery`);
  return ok(`read ${label} state`, client.from("jobs")
    .select("main_status, incident, submitted_at, approved_at, paid_at").eq("id", jobId).single());
}

async function importPdf(client, file) {
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf") || file.bytes.length === 0) {
    return { success: false, message: "invalid" };
  }
  const title = file.name.replace(/\.pdf$/iu, "").trim().slice(0, 200);
  const existing = await ok("check existing import", client.from("jobs").select("id").eq("title", title)
    .not("project_pdf_url", "is", null).limit(1).maybeSingle());
  if (existing) return { success: true, id: existing.id, existing: true };
  const id = randomUUID();
  const path = `${id}/${file.name.replace(/[^a-zA-Z0-9._-]+/gu, "-")}`;
  const upload = await client.storage.from("project-files").upload(path, file.bytes, { contentType: file.type, upsert: false });
  if (upload.error) return { success: false, message: "upload" };
  projectObjects.push(path);
  const inserted = await client.from("jobs").insert({ id, title, project_pdf_url: path }).select("id").single();
  if (inserted.error) {
    await client.storage.from("project-files").remove([path]);
    projectObjects.splice(projectObjects.indexOf(path), 1);
    return { success: false, message: "insert" };
  }
  jobs.push(id);
  return { success: true, id, existing: false };
}

async function cleanup() {
  const errors = [];
  if (projectObjects.length && (await service.storage.from("project-files").remove(projectObjects)).error) errors.push("project-files");
  if (evidenceObjects.length && (await service.storage.from("job-evidence").remove(evidenceObjects)).error) errors.push("job-evidence");
  if (jobs.length && (await service.from("jobs").delete().in("id", jobs)).error) errors.push("jobs");
  if (users.length && (await service.from("technician_shifts").delete().in("technician_id", users)).error) errors.push("shifts");
  for (const id of [...users].reverse()) if ((await service.auth.admin.deleteUser(id)).error) errors.push("users");
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`Cleanup failed [${[...new Set(errors)].join(",")}]`);
}

async function main() {
  const admin = await identity("admin", "admin");
  adminClient = admin.client;
  const supervisor = await identity("supervisor", "supervisor");
  const technician = await identity("technician", "tecnico");
  const other = await identity("other", "tecnico");
  const outsider = await identity("outsider", "tecnico");

  const inhouseCategory = await ok("read active Inhouse category", admin.client.from("price_categories")
    .select("id").eq("slug", "inhouse").eq("active", true).single());
  await ok("assign technician Inhouse category", admin.client.rpc("set_technician_price_category", {
    p_technician_id: technician.id,
    p_price_category_id: inhouseCategory.id,
  }));

  await startShift(technician, "technician");
  await startShift(other, "other technician");
  await startShift(outsider, "outsider technician");

  await denied("new crew creation is retired for Admin", admin.client.from("crews").insert({
    name: `Retired crew ${runId}`, lead_technician_id: technician.id,
  }).select("id"));
  const directJobA = await createJob(supervisor.client, `Direct bulk A ${runId}`);
  const directJobB = await createJob(supervisor.client, `Direct bulk B ${runId}`);
  const directAssigned = await assign(supervisor.client, [directJobA, directJobB], technician.id);
  check(directAssigned.length === 2 && directAssigned.every((row) => row.technician_id === technician.id), "bulk individual assignment persisted");
  const directJobs = await ok("technician sees bulk jobs", technician.client.from("jobs").select("id").in("id", [directJobA, directJobB]));
  check(directJobs.length === 2, "technician sees both bulk jobs");
  await denied("new crew assignment is retired", supervisor.client.rpc("assign_jobs_atomic", {
    job_ids: [directJobA], new_assignee_type: "crew", new_assignee_id: randomUUID(),
  }));
  await denied("ambiguous assignment rejected", supervisor.client.from("job_assignments").insert({
    job_id: directJobA, assignee_type: "technician", technician_id: technician.id, crew_id: randomUUID(), assigned_by: supervisor.id,
  }).select("id"));

  const officeJob = await createJob(supervisor.client, `Final office ${runId}`);
  await assign(supervisor.client, [officeJob], technician.id);
  await denied("invalid assigned-to-approved transition rejected", supervisor.client.from("jobs")
    .update({ main_status: "aprobado" }).eq("id", officeJob).select("id"));
  const assignedView = await ok("technician sees assigned job", technician.client.from("jobs").select("id").eq("id", officeJob));
  check(assignedView.length === 1, "assigned job visible");
  await denied("foreign technician cannot see assigned job", other.client.from("jobs").select("id").eq("id", officeJob));
  await status(technician.client, officeJob, "en_progreso");
  const officePhotoId = await prepareEvidence(technician.client, officeJob, technician.id);
  await denied("direct technician submission rejected", technician.client.from("jobs")
    .update({ main_status: "enviado_revision" }).eq("id", officeJob).select("id"));
  const submitted = await deliver(technician.client, officeJob, [officePhotoId], "technician atomically submits office job");
  check(Boolean(submitted.submitted_at), "submission timestamp recorded");
  await denied("technician cannot approve", technician.client.from("jobs").update({ main_status: "aprobado" }).eq("id", officeJob).select("id"));
  await denied("correction return without reason rejected", supervisor.client.from("jobs")
    .update({ main_status: "en_progreso", comments: "" }).eq("id", officeJob).select("id"));
  await status(supervisor.client, officeJob, "en_progreso", { comments: "Corrección runtime requerida" });
  const correction = await ok("read correction audit", supervisor.client.from("job_status_history")
    .select("previous_status,new_status,changed_by,notes").eq("job_id", officeJob)
    .eq("previous_status", "enviado_revision").eq("new_status", "en_progreso").single());
  check(correction.changed_by === supervisor.id && correction.notes === "Corrección runtime requerida", "correction reason and actor audited");
  await deliver(technician.client, officeJob, [officePhotoId], "technician atomically resubmits office job");
  const approved = await status(supervisor.client, officeJob, "aprobado");
  check(Boolean(approved.approved_at), "approval timestamp recorded");
  await status(supervisor.client, officeJob, "listo_pagar");
  const paid = await status(supervisor.client, officeJob, "pagado");
  check(Boolean(paid.paid_at), "payment timestamp recorded");
  const officeHistory = await ok("read office lifecycle history", supervisor.client.from("job_status_history")
    .select("previous_status,new_status,changed_by").eq("job_id", officeJob));
  check(officeHistory.filter((row) => row.previous_status !== row.new_status).length === 8, "eight lifecycle transitions audited including assignment and correction");

  const fieldJob = await createJob(supervisor.client, `Final field ${runId}`);
  await assign(supervisor.client, [fieldJob], technician.id);
  await status(technician.client, fieldJob, "en_progreso");
  const beforeForeign = await ok("count history before foreign incident", supervisor.client.from("job_status_history")
    .select("id", { count: "exact" }).eq("job_id", fieldJob));
  await denied("foreign incident mutation denied", outsider.client.from("jobs")
    .update({ incident: "no_access", incident_notes: "forbidden" }).eq("id", fieldJob).select("id"));
  const afterForeign = await ok("count history after foreign incident", supervisor.client.from("job_status_history")
    .select("id", { count: "exact" }).eq("job_id", fieldJob));
  check(afterForeign.length === beforeForeign.length, "foreign incident denial adds no history");
  const incident = await ok("technician reports incident", technician.client.from("jobs")
    .update({ incident: "no_access", incident_notes: "runtime blocked" }).eq("id", fieldJob).select("main_status,incident").single());
  check(incident.main_status === "en_progreso" && incident.incident === "no_access", "incident preserves progress");
  const cleared = await ok("technician clears incident", technician.client.from("jobs")
    .update({ incident: null, incident_notes: null }).eq("id", fieldJob).select("main_status,incident").single());
  check(cleared.main_status === "en_progreso" && cleared.incident === null, "incident clear preserves progress");
  const catalog = await ok("technician lists applicable production catalog", technician.client.rpc("list_my_production_catalog"));
  const activity = catalog.find((row) => row.code === "AC01");
  check(Boolean(activity), "production catalog includes AC01");
  await ok("technician adds priced production code", technician.client.rpc("add_job_production", {
    p_job_id: fieldJob, p_catalog_id: activity.id, p_quantity: 2, p_production_date: null, p_notes: "final runtime",
  }));
  const visibleCodes = await ok("technician reads assigned production codes", technician.client.from("job_production_codes")
    .select("code,quantity,added_by").eq("job_id", fieldJob));
  check(visibleCodes.length === 1 && visibleCodes[0].code === "AC01" && visibleCodes[0].added_by === technician.id, "authorized production code read succeeds");
  const fieldPhotoId = await prepareEvidence(technician.client, fieldJob, technician.id);
  await deliver(technician.client, fieldJob, [fieldPhotoId], "technician atomically submits field job");
  const fieldHistory = await ok("read field history", technician.client.from("job_status_history")
    .select("previous_status,new_status,previous_incident,new_incident,changed_by").eq("job_id", fieldJob));
  check(fieldHistory.filter((row) => row.previous_status !== row.new_status).length === 3, "field assignment and status changes audited");
  check(fieldHistory.filter((row) => row.previous_incident !== row.new_incident).length === 2, "incident changes audited");
  check(fieldHistory.every((row) => {
    if (row.previous_status === "sin_asignar" && row.new_status === "asignado") {
      return row.changed_by === supervisor.id;
    }
    return row.changed_by === technician.id || row.previous_status === row.new_status;
  }), "assignment and field actors are audited correctly");

  const hiddenJob = await createJob(supervisor.client, `Final hidden ${runId}`);
  await denied("technician cannot see unassigned job", technician.client.from("jobs").select("id").eq("id", hiddenJob));

  const pdfs = [
    { name: `Plano-A-${runId}.pdf`, type: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70, 45, 65]) },
    { name: `Plano-B-${runId}.pdf`, type: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70, 45, 66]) },
    { name: `Plano-C-${runId}.pdf`, type: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70, 45, 67]) },
  ];
  const imported = await Promise.all(pdfs.map((file) => importPdf(supervisor.client, file)));
  check(imported.every((row) => row.success && !row.existing), "three PDFs imported independently");
  const invalid = await importPdf(supervisor.client, { name: `Bad-${runId}.txt`, type: "text/plain", bytes: new Uint8Array([1]) });
  check(!invalid.success, "non-PDF rejected without job");
  const titles = pdfs.map((file) => file.name.replace(/\.pdf$/iu, ""));
  const search = await ok("search imported PDF title", supervisor.client.from("jobs").select("id,title,category,main_status,project_pdf_url")
    .ilike("title", `%Plano-B-${runId}%`));
  check(search.length === 1 && search[0].category === "categoria_1" && search[0].main_status === "sin_asignar" && Boolean(search[0].project_pdf_url), "unassigned import defaults and filename search work");
  await assign(supervisor.client, [imported[0].id], technician.id);
  const bulk = await assign(supervisor.client, [imported[1].id, imported[2].id], technician.id);
  check(bulk.length === 2, "bulk assignment returns both imported jobs");
  const retry = await Promise.all(pdfs.map((file) => importPdf(supervisor.client, file)));
  check(retry.every((row, index) => row.success && row.existing && row.id === imported[index].id), "retry reuses confirmed imports");
  const duplicates = await ok("count imported titles after retry", supervisor.client.from("jobs").select("id,title").in("title", titles));
  check(duplicates.length === 3, "retry created no duplicate jobs");
  const importedView = await ok("technician sees all assigned imports", technician.client.from("jobs").select("id").in("id", imported.map((row) => row.id)));
  check(importedView.length === 3, "individual and bulk assignments visible through RLS");

  const actionSource = readFileSync(new URL("../src/lib/storage/actions.ts", import.meta.url), "utf8");
  const coreSource = readFileSync(new URL("../src/lib/storage/core.ts", import.meta.url), "utf8");
  assert.match(actionSource, /prepareBulkProjectUploadCore\(await createClient\(\), input\)/u);
  assert.match(actionSource, /confirmBulkProjectUploadCore\(await createClient\(\), input\)/u);
  assert.doesNotMatch(actionSource, /FormData|File|Blob|ArrayBuffer|Uint8Array/u);
  assert.doesNotMatch(coreSource, /importProjectPdfs/u);
  assert.doesNotMatch(actionSource, /uploadProjectPdfs/u);
  checks += 5;
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally { try { await cleanup(); } catch (error) { failure ??= error; } }

if (failure) {
  console.error(`[jobs-final] FAIL ${failure.message} cleanup=${cleanupPassed ? "passed" : "failed"}`);
  process.exitCode = 1;
} else {
  console.log(`[jobs-final] PASS checks=${checks} cleanup=passed users=${users.length} jobs=${jobs.length} objects=${projectObjects.length + evidenceObjects.length}`);
}
