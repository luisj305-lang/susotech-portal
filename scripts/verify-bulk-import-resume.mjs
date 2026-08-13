import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { confirmBulkProjectUploadCore, prepareBulkProjectUploadCore } from "../src/lib/storage/bulk-import-core.ts";
import { applyPdfPreview, createImportRows, groupAssignmentChunks } from "../src/components/jobs/bulk-import-model.ts";

const base = {
  batchId: null, fileName: "Plano 42.pdf", fileHash: "a".repeat(64), fileSize: 4_005_680,
  mimeType: "application/pdf", pdfHeader: "%PDF-", fields: { title: "Plano 42", orderIdentifier: null,
    prismNumber: null, address: null, location: null, customerName: null, requestDate: null, jobType: null, description: null },
};
const calls = [];
const item = { batch_id: "b1", item_id: "i1", proposed_job_id: "j1", storage_path: "j1/plano-42.pdf", item_status: "prepared", confirmed_job_id: null };
const client = {
  rpc: async (name, args) => { calls.push([name, args]); return name === "prepare_job_import_item" ? { data: [item], error: null } : { data: [{ result_status: "imported", confirmed_job_id: "j1" }], error: null }; },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { ...item, source_file_name: base.fileName, source_file_hash: base.fileHash, source_file_size: base.fileSize, source_mime_type: base.mimeType, declared_pdf_header: base.pdfHeader }, error: null }) }) }) }),
  storage: { from: () => ({
    createSignedUploadUrl: async () => ({ data: { token: "token", signedUrl: "https://storage/upload" }, error: null }),
    list: async () => ({ data: [{ name: "plano-42.pdf", metadata: { mimetype: base.mimeType, size: base.fileSize } }], error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://storage/read" }, error: null }),
    remove: async () => ({ error: null }),
  }) },
};
const prepared = await prepareBulkProjectUploadCore(client, base);
assert.equal(prepared.success, true); assert.equal(prepared.data.itemId, "i1"); assert.equal(calls[0][0], "prepare_job_import_item");
const resumed = await prepareBulkProjectUploadCore(client, { ...base, batchId: "b1" });
assert.equal(resumed.success, true); assert.equal(resumed.data.itemId, prepared.data.itemId);
const staleBatchClient = {
  ...client,
  rpc: async () => ({ data: null, error: { code: "P0001", message: "Batch unavailable", details: null } }),
};
const staleBatch = await prepareBulkProjectUploadCore(staleBatchClient, { ...base, batchId: "deleted-batch" });
assert.equal(staleBatch.success, false); assert.equal(staleBatch.reason, "batch_unavailable");
assert.match(staleBatch.message, /lote guardado ya no está disponible/u);
for (const [message, reason] of [
  ["Invalid import metadata", "invalid_metadata"],
  ["Batch limit exceeded", "batch_limit_exceeded"],
  ["Only active office staff can import jobs", "permission_denied"],
  ["TypeError: Failed to fetch", "network_error"],
]) {
  const failure = await prepareBulkProjectUploadCore({ ...staleBatchClient, rpc: async () => ({ data: null, error: { code: "P0001", message, details: null } }) }, base);
  assert.equal(failure.success, false); assert.equal(failure.reason, reason);
}
for (const patch of [{ mimeType: "text/plain" }, { fileName: "bad.txt" }, { fileSize: 0 }, { pdfHeader: "HELLO" }, { fileHash: "bad" }]) {
  assert.equal((await prepareBulkProjectUploadCore(client, { ...base, ...patch })).success, false);
}
globalThis.fetch = async (_url, init) => { assert.equal(init.headers.Range, "bytes=0-4"); return { ok: true, status: 206, headers: { get: () => "bytes 0-4/4005680" }, text: async () => "%PDF-" }; };
const confirmed = await confirmBulkProjectUploadCore(client, { itemId: "i1" });
assert.equal(confirmed.success, true); assert.equal(confirmed.data.jobId, "j1"); assert.equal(calls.at(-1)[0], "confirm_job_import_item");
globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "%PDF-ignored-range" });
assert.equal((await confirmBulkProjectUploadCore(client, { itemId: "i1" })).success, false);
const actions = await readFile(new URL("../src/lib/storage/actions.ts", import.meta.url), "utf8");
assert.doesNotMatch(actions, /uploadProjectPdfs|FormData|File|Blob|ArrayBuffer|Uint8Array/u);
assert.match(actions, /prepareBulkProjectUploadCore/u); assert.match(actions, /confirmBulkProjectUploadCore/u);
const sql = await readFile(new URL("../supabase/migrations/20260810005000_jobs_bulk_import_resume.sql", import.meta.url), "utf8");
assert.match(sql, /job_import_batches/u); assert.match(sql, /job_import_items/u);
assert.match(sql, /unique \(batch_id, source_file_hash, source_file_size\)/u);
assert.match(sql, /job_imports_hash_size_idx/u); assert.doesNotMatch(sql, /job_assignments/u);
assert.match(sql, /count\(\*\).*>= 100/su); assert.match(sql, /metadata->>'mimetype'/u); assert.match(sql, /metadata->>'size'/u);
assert.match(sql, /source_file_size in \(0,item\.source_file_size\)/u); assert.match(sql, /revoke execute on function public\.confirm_job_import/u);
assert.match(sql, /item_status in \('prepared','imported','duplicate','error'\)/u);
assert.match(sql, /pg_advisory_xact_lock.*job-order:/u);
const grouped = groupAssignmentChunks([
  { key: "a", state: "imported", jobId: "j1", assigneeType: "technician", assigneeId: "t1" },
  { key: "b", state: "imported", jobId: "j2", assigneeType: "crew", assigneeId: "c1" },
  { key: "c", state: "duplicate", jobId: "j3", assigneeType: "crew", assigneeId: "c1" },
  { key: "d", state: "imported", jobId: "j4", assigneeType: "crew", assigneeId: "c1", assignmentState: "assigned" },
]);
assert.equal(grouped.length, 2); assert.deepEqual(grouped.map((group) => group.jobIds), [["j1"], ["j2"]]);
const chunks = groupAssignmentChunks(Array.from({ length: 101 }, (_, index) => ({ key: `r${index}`, state: "imported", jobId: `j${index}`, assigneeType: "crew", assigneeId: "c1" })));
assert.deepEqual(chunks.map((chunk) => chunk.jobIds.length), [100, 1]);
const simulated = createImportRows(Array.from({ length: 50 }, (_, index) => new File([`%PDF-${index}`], `simulated-${index}.pdf`, { type: "application/pdf" })));
assert.equal(simulated.length, 50); assert.equal(simulated.every((row) => row.state === "processing"), true);
const localRows = createImportRows([new File(["%PDF-a"], "same.pdf", { type: "application/pdf" }), new File(["%PDF-a"], "copy.pdf", { type: "application/pdf" })]);
const preview = { fields: base.fields, fileHash: base.fileHash, pageCount: 1, responsibleSuggestion: null };
const analyzed = applyPdfPreview(applyPdfPreview(localRows, localRows[0].key, preview), localRows[1].key, preview);
assert.equal(analyzed[0].state, "pending"); assert.equal(analyzed[1].state, "duplicate"); assert.equal(analyzed[1].selected, false);
const component = await readFile(new URL("../src/components/jobs/bulk-import.tsx", import.meta.url), "utf8");
assert.doesNotMatch(component, /createSignedUploadUrl|confirmProjectPdfImport|createBulkUploadTarget/u);
for (const contract of [/prepareBulkProjectUpload/u, /confirmBulkProjectUpload/u, /assignJobsInBulk/u, /uploadToSignedUrl/u, /Storage privado/u, /localStorage/u, /> 100/u, /prepared\.reason === "batch_unavailable"/u, /localStorage\.removeItem\("jobs-import-batch"\)/u, /prepared = await prepare\(null\)/u, /const first = remaining\.shift\(\)/u, /mapWithConcurrency\(remaining, 3/u]) assert.match(component, contract);
const core = await readFile(new URL("../src/lib/storage/bulk-import-core.ts", import.meta.url), "utf8");
assert.match(core, /createSignedUploadUrl\(row\.storage_path, \{ upsert: true \}\)/u); assert.match(core, /response\.status !== 206/u);
const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
assert.doesNotMatch(nextConfig, /bodySizeLimit/u);
assert.match(sql, /for update/u);
await assert.rejects(readFile(new URL("../src/lib/jobs/import-core.ts", import.meta.url), "utf8"));
console.log("[bulk-import-resume] PASS checks=49 metadata_only=true resumable=true grouped_assignment=true simulated=50");
