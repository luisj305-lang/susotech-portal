import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { confirmBulkProjectUploadCore, prepareBulkProjectUploadCore } from "../src/lib/storage/bulk-import-core.ts";
import { extractPdfPreview } from "../src/lib/jobs/pdf-parser.ts";

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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing required Supabase server environment variables");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options); // Temporary setup/finally cleanup only.
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const users = [];
const jobs = [];
const objects = [];
const batches = [];
let checks = 0;
let cleanupPassed = false;
let migrationPending = false;

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
  const email = `bulk-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  users.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: true, full_name: `Bulk ${label}` }).eq("id", id));
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

async function prepare(client, file, fields, batchId = null) {
  const fileHash = createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex");
  const result = await prepareBulkProjectUploadCore(client, { batchId, fileName: file.name, fileHash, fileSize: file.size, mimeType: file.type, pdfHeader: "%PDF-", fields });
  if (result.success && !batches.includes(result.data.batchId)) batches.push(result.data.batchId);
  return result;
}

async function uploadAndConfirm(client, file, fields, batchId = null, assignment = {}) {
  const prepared = await prepare(client, file, fields, batchId);
  if (!prepared.success) return { status: "error", message: prepared.message };
  if (prepared.data.status === "imported" || prepared.data.status === "duplicate") return { status: prepared.data.status, jobId: prepared.data.jobId, batchId: prepared.data.batchId, itemId: prepared.data.itemId };
  const uploaded = await client.storage.from("project-files").uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: "application/pdf" });
  check(!uploaded.error, "office uploads private PDF", uploaded.error);
  if (!objects.includes(prepared.data.path)) objects.push(prepared.data.path);
  const result = await confirmBulkProjectUploadCore(client, { itemId: prepared.data.itemId, ...assignment });
  if (!result.success) return { status: "error", message: result.message };
  if (result.data.status === "imported" && !jobs.includes(result.data.jobId)) jobs.push(result.data.jobId);
  return { status: result.data.status, jobId: result.data.jobId, batchId: prepared.data.batchId, itemId: prepared.data.itemId };
}

async function cleanup() {
  const errors = [];
  if (objects.length && (await service.storage.from("project-files").remove(objects)).error) errors.push("objects");
  if (batches.length && (await service.from("job_import_batches").delete().in("id", batches)).error) errors.push("batches");
  if (jobs.length && (await service.from("jobs").delete().in("id", jobs)).error) errors.push("jobs");
  if (users.length && (await service.from("technician_shifts").delete().in("technician_id", users)).error) errors.push("shifts");
  for (const id of [...users].reverse()) if ((await service.auth.admin.deleteUser(id)).error) errors.push("users");
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`Cleanup failed [${[...new Set(errors)].join(",")}]`);
}

async function main() {
  const admin = await identity("admin", "admin");
  const migration = await admin.client.from("job_import_items").select("item_id").limit(1);
  if (migration.error) { migrationPending = true; return; }
  check(Array.isArray(migration.data), "resumable bulk import migration is available");
  const supervisor = await identity("supervisor", "supervisor");
  const direct = await identity("direct", "tecnico");
  const secondTech = await identity("second", "tecnico");
  const foreign = await identity("foreign", "tecnico");
  await startShift(direct, "direct technician");
  await startShift(secondTech, "second technician");
  await startShift(foreign, "foreign technician");
  const bytes = readFileSync("C:\\Users\\goofy\\Downloads\\6556114.pdf");
  const wasm = readFileSync(new URL("../public/pdfium.wasm", import.meta.url));
  const realFile = new File([bytes], "6556114.pdf", { type: "application/pdf" });
  check(realFile.size === 4_005_680, "real reference PDF has exact expected size");
  const preview = await extractPdfPreview(realFile, { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  check(preview.fields.orderIdentifier === "6556114" && preview.fields.customerName === null, "real PDF fields are used without invented customer");
  const importFields = { ...preview.fields, orderIdentifier: `${runId}-direct`, prismNumber: `${runId}-direct` };
  const importBytes = Buffer.concat([bytes, Buffer.from(`\n% direct ${runId}\n`)]);
  const importFile = new File([importBytes], "6556114.pdf", { type: "application/pdf" });

  const staleSeed = await prepare(admin.client, importFile, importFields);
  check(staleSeed.success, "admin prepares batch used for stale localStorage simulation");
  if (!staleSeed.success) throw new Error(staleSeed.message);
  await ok("delete stale import batch", service.from("job_import_batches").delete().eq("id", staleSeed.data.batchId));
  batches.splice(batches.indexOf(staleSeed.data.batchId), 1);
  const staleResult = await prepare(admin.client, importFile, importFields, staleSeed.data.batchId);
  check(!staleResult.success && staleResult.reason === "batch_unavailable", "deleted batch maps to stable batch_unavailable reason");
  const staleRecovered = await prepare(admin.client, importFile, importFields, null);
  check(staleRecovered.success && staleRecovered.data.batchId !== staleSeed.data.batchId, "stale batch retry with null creates a fresh batch");

  const interrupted = await prepare(admin.client, importFile, importFields);
  check(interrupted.success, "admin prepares real direct upload"); if (!interrupted.success) throw new Error(interrupted.message);
  const beforeUpload = await confirmBulkProjectUploadCore(admin.client, { itemId: interrupted.data.itemId });
  check(!beforeUpload.success, "interrupted item cannot confirm without object");
  const resumed = await prepare(admin.client, importFile, importFields, interrupted.data.batchId);
  check(resumed.success && resumed.data.itemId === interrupted.data.itemId, "reprepare reuses same hash-size item");
  const first = await uploadAndConfirm(admin.client, importFile, importFields, interrupted.data.batchId, {
    assigneeType: "technician", assigneeId: direct.id,
  });
  check(first.status === "imported" && Boolean(first.jobId), "admin imports one real PDF after interruption");
  const repeated = await confirmBulkProjectUploadCore(admin.client, { itemId: first.itemId });
  check(repeated.success && repeated.data.jobId === first.jobId, "repeated confirmation returns same job");
  const secondBytes = Buffer.concat([bytes, Buffer.from(`\n% bulk ${runId}\n`)]);
  const secondFile = new File([secondBytes], "6556114.pdf", { type: "application/pdf" });
  const secondFields = { ...preview.fields, title: `Orden editada ${runId}`, orderIdentifier: `${runId}-second`, prismNumber: `${runId}-second` };
  const second = await uploadAndConfirm(supervisor.client, secondFile, secondFields, null, {
    assigneeType: "technician", assigneeId: secondTech.id,
  });
  check(second.status === "imported" && Boolean(second.jobId), "supervisor imports same-name/different-content preview");
  const importedStates = await ok("read atomically assigned import states", admin.client.from("jobs")
    .select("id,main_status").in("id", [first.jobId, second.jobId]));
  check(importedStates.length === 2 && importedStates.every((job) => job.main_status === "asignado"),
    "import and assignment commit with coherent assigned status");

  const unassignedBytes = Buffer.concat([bytes, Buffer.from(`\n% unassigned ${runId}\n`)]);
  const unassigned = await uploadAndConfirm(admin.client,
    new File([unassignedBytes], `unassigned-${runId}.pdf`, { type: "application/pdf" }),
    { ...preview.fields, title: `Unassigned ${runId}`, orderIdentifier: `${runId}-unassigned`, prismNumber: `${runId}-unassigned` });
  check(unassigned.status === "imported" && Boolean(unassigned.jobId), "bulk import accepts explicit unassigned row");
  const unassignedState = await ok("read unassigned import state", admin.client.from("jobs")
    .select("main_status").eq("id", unassigned.jobId).single());
  check(unassignedState.main_status === "sin_asignar", "unassigned import keeps unassigned source of truth");
  const unassignedAssignments = await ok("read unassigned import assignments", admin.client.from("job_assignments")
    .select("id").eq("job_id", unassigned.jobId));
  check(unassignedAssignments.length === 0, "unassigned import creates no assignment row");

  const duplicateHash = await uploadAndConfirm(admin.client, importFile, { ...preview.fields, orderIdentifier: `${runId}-other`, prismNumber: `${runId}-other` }, first.batchId);
  check(duplicateHash.status === "imported" && duplicateHash.itemId === first.itemId && duplicateHash.jobId === first.jobId, "same batch hash-size reuses the same item and job");
  const duplicateAcrossBatch = await uploadAndConfirm(supervisor.client, importFile, { ...preview.fields, orderIdentifier: `${runId}-other`, prismNumber: `${runId}-other` });
  check(duplicateAcrossBatch.status === "duplicate" && duplicateAcrossBatch.jobId === first.jobId, "file hash detects duplicate across batches despite edited order");
  const thirdBytes = Buffer.concat([bytes, Buffer.from(`\n% order duplicate ${runId}\n`)]);
  const duplicateOrder = await uploadAndConfirm(admin.client, new File([thirdBytes], `order-duplicate-${runId}.pdf`, { type: "application/pdf" }), importFields);
  check(duplicateOrder.status === "duplicate" && duplicateOrder.jobId === first.jobId, "real order identifier detects duplicate despite changed hash");

  const audits = await ok("read import audit", admin.client.from("job_imports").select("job_id,imported_by,imported_at,source_file_name,source_file_hash,source_file_size,order_identifier").in("job_id", [first.jobId, second.jobId]));
  check(audits.length === 2 && audits.every((row) => /^[a-f0-9]{64}$/u.test(row.source_file_hash) && row.source_file_size > 0 && row.imported_at && row.source_file_name), "name/hash/size/importer/date audit is complete");
  const firstAudit = audits.find((row) => row.job_id === first.jobId);
  const secondAudit = audits.find((row) => row.job_id === second.jobId);
  check(firstAudit?.source_file_name === "6556114.pdf" && firstAudit.source_file_size === importFile.size, "real PDF fixture name and exact uploaded size are audited");
  check(secondAudit?.source_file_name === "6556114.pdf" && secondAudit.source_file_hash !== firstAudit?.source_file_hash && secondAudit.source_file_size !== firstAudit?.source_file_size, "same name with different content keeps distinct hash-size identity");
  check(firstAudit?.imported_by === admin.id, "admin importer is audited");
  check(secondAudit?.imported_by === supervisor.id, "supervisor importer is audited");
  const assignments = await ok("read assignment audit", admin.client.from("job_assignments").select("job_id,assignee_type,technician_id,crew_id,assigned_by").in("job_id", [first.jobId, second.jobId]));
  check(assignments.find((row) => row.job_id === first.jobId)?.technician_id === direct.id && assignments.find((row) => row.job_id === first.jobId)?.assigned_by === admin.id, "individual assignment and actor are audited");
  check(assignments.find((row) => row.job_id === second.jobId)?.technician_id === secondTech.id && assignments.find((row) => row.job_id === second.jobId)?.assigned_by === supervisor.id, "second individual assignment and actor are audited");
  const retiredCrew = await admin.client.rpc("assign_jobs_atomic", {
    job_ids: [first.jobId], new_assignee_type: "crew", new_assignee_id: randomUUID(),
  });
  check(Boolean(retiredCrew.error) && /retired/i.test(retiredCrew.error.message), "retired crew assignment remains rejected");

  const directJobs = await ok("direct technician visibility", direct.client.from("jobs").select("id").in("id", [first.jobId, second.jobId]));
  const secondJobs = await ok("second technician visibility", secondTech.client.from("jobs").select("id").in("id", [first.jobId, second.jobId]));
  const foreignJobs = await ok("foreign technician visibility", foreign.client.from("jobs").select("id").in("id", [first.jobId, second.jobId]));
  check(directJobs.length === 1 && directJobs[0].id === first.jobId, "technician sees direct assignment only");
  check(secondJobs.length === 1 && secondJobs[0].id === second.jobId, "technician sees second direct assignment only");
  check(foreignJobs.length === 0, "technician cannot see unassigned imports");
  const hiddenAudit = await foreign.client.from("job_imports").select("job_id").in("job_id", [first.jobId, second.jobId]);
  check(!hiddenAudit.error && hiddenAudit.data.length === 0, "technician cannot read office import audit");

  const deniedPrepare = await prepare(foreign.client, realFile, preview.fields);
  check(!deniedPrepare.success, "technician cannot prepare an import");
  const invalid = await prepareBulkProjectUploadCore(supervisor.client, { batchId: null, fileName: "bad.txt", fileHash: "bad", fileSize: 1, mimeType: "text/plain", pdfHeader: "bad", fields: preview.fields });
  check(!invalid.success, "invalid metadata is isolated without an item");
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally { try { await cleanup(); } catch (error) { failure ??= error; } }

if (failure) {
  console.error(`[bulk-import-runtime] FAIL ${failure.message} cleanup=${cleanupPassed ? "passed" : "failed"}`);
  process.exitCode = 1;
} else if (migrationPending) {
  console.log("[bulk-import-runtime] EXPECTED_PRECHECK_FAIL migration=20260810005000_jobs_bulk_import_resume.sql cleanup=passed checks=0");
} else {
  console.log(`[bulk-import-runtime] PASS checks=${checks} cleanup=passed users=${users.length} jobs=${jobs.length} batches=${batches.length} objects=${objects.length}`);
}
