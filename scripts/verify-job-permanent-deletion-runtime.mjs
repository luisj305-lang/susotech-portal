import assert from "node:assert/strict";
import { cleanupJobDeletionQueue } from "../src/lib/jobs/deletion-core.ts";

const objects = new Map([
  ["project-files", new Set(["job-1/original.pdf"])],
  ["job-evidence", new Set(["job-1/photo.jpg"])],
]);
const finished = [];
let evidenceFails = true;

const client = {
  storage: {
    from(bucket) {
      return {
        async remove(paths) {
          if (bucket === "job-evidence" && evidenceFails) {
            return { error: { message: "temporary storage failure" } };
          }
          for (const path of paths) objects.get(bucket).delete(path);
          return { error: null };
        },
        async list(folder, { search }) {
          const prefix = folder ? `${folder}/` : "";
          const data = [...objects.get(bucket)]
            .filter((path) => path === `${prefix}${search}`)
            .map((path) => ({ name: path.slice(prefix.length) }));
          return { data, error: null };
        },
      };
    },
  },
  async rpc(name, args) {
    assert.equal(name, "finish_job_deletion_cleanup");
    finished.push(args);
    return { error: null };
  },
};

const rows = [
  { queue_id: 1, bucket_id: "project-files", object_name: "job-1/original.pdf" },
  { queue_id: 2, bucket_id: "job-evidence", object_name: "job-1/photo.jpg" },
];

const partial = await cleanupJobDeletionQueue(client, rows);
assert.deepEqual(partial, { completed: 1, pending: 1 });
assert.deepEqual(finished[0].p_completed_ids, [1]);
assert.deepEqual(finished[0].p_failed_ids, [2]);
assert.equal(objects.get("job-evidence").has("job-1/photo.jpg"), true);

evidenceFails = false;
const retried = await cleanupJobDeletionQueue(client, [rows[1]]);
assert.deepEqual(retried, { completed: 1, pending: 0 });
assert.deepEqual(finished[1].p_completed_ids, [2]);
assert.equal(objects.get("job-evidence").has("job-1/photo.jpg"), false);

console.log("PASS permanent archived-job deletion retry runtime checks");
