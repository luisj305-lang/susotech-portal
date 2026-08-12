import assert from "node:assert/strict";
import { validJobDocumentMetadata, JOB_DOCUMENT_LIMIT } from "../src/lib/storage/job-document-core.ts";
import { cleanupJobDeletionQueue } from "../src/lib/jobs/deletion-core.ts";

const jobId = "11111111-1111-4111-8111-111111111111";
const valid = { jobId, fileName: "Permit Package.pdf", mimeType: "application/pdf", size: 1024 };
assert.equal(validJobDocumentMetadata(valid), true);
assert.equal(validJobDocumentMetadata({ ...valid, mimeType: "text/plain" }), false);
assert.equal(validJobDocumentMetadata({ ...valid, fileName: "permit.exe" }), false);
assert.equal(validJobDocumentMetadata({ ...valid, size: 0 }), false);
assert.equal(validJobDocumentMetadata({ ...valid, size: JOB_DOCUMENT_LIMIT + 1 }), false);

const path = `${jobId}/attachments/22222222-2222-4222-8222-222222222222.pdf`;
const stored = new Set([path]);
const finished = [];
let fail = true;
const client = {
  storage: { from: () => ({
    async remove(paths) {
      if (fail) return { error: { message: "temporary" } };
      paths.forEach((item) => stored.delete(item));
      return { error: null };
    },
    async list(folder, { search }) {
      return { data: stored.has(`${folder}/${search}`) ? [{ name: search }] : [], error: null };
    },
  }) },
  async rpc(name, args) {
    assert.equal(name, "finish_job_deletion_cleanup");
    finished.push(args);
    return { error: null };
  },
};
const row = { queue_id: 9, bucket_id: "project-files", object_name: path };
assert.deepEqual(await cleanupJobDeletionQueue(client, [row]), { completed: 0, pending: 1 });
assert.deepEqual(finished[0].p_failed_ids, [9]);
fail = false;
assert.deepEqual(await cleanupJobDeletionQueue(client, [row]), { completed: 1, pending: 0 });
assert.deepEqual(finished[1].p_completed_ids, [9]);

console.log("PASS multiple job PDF attachment runtime checks");
