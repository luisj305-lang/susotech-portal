import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

let source = ts.transpileModule(readFileSync(new URL("./cleanup.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
source = source.replace('import "server-only";', "")
  .replace('"@/lib/supabase/service"', JSON.stringify("data:text/javascript,export function createServiceClient(){return globalThis.__cleanupDb}"))
  .replace('"./public-input"', JSON.stringify('data:text/javascript,export const RESUME_BUCKET="recruitment-resumes"'));
const { cleanupExpiredRecruitment } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function mock({ rows = [{ id: "example", resume_path: "example/resume.pdf" }], lookupError = false, storageError = false, deleteError = false } = {}) {
  const events = [];
  const db = {
    events,
    from(table) {
      assert.equal(table, "recruitment_applications");
      let deleting = false;
      const q = {
        delete() { deleting = true; events.push("delete"); return q; },
        select() { return q; },
        eq(key, value) { assert.equal(key, "submission_state"); assert.equal(value, "pending"); return q; },
        lt(key, value) { assert.equal(key, "submission_expires_at"); assert.ok(Date.parse(value) <= Date.now() - 86400000); return q; },
        order(key) { assert.equal(key, "submission_expires_at"); return q; },
        limit(count) { assert.equal(count, 50); return q; },
        in(key, ids) { assert.equal(key, "id"); assert.deepEqual(ids, rows.map(row => row.id)); return q; },
        then(resolve) { events.push(deleting ? "deleted" : "lookup"); return Promise.resolve({ data: rows, error: deleting ? deleteError : lookupError }).then(resolve); },
      };
      return q;
    },
    storage: { from(bucket) { assert.equal(bucket, "recruitment-resumes"); return {
      async remove(paths) { events.push("storage"); assert.deepEqual(paths, rows.map(row => row.resume_path).filter(Boolean)); return { error: storageError }; },
    }; } },
  };
  globalThis.__cleanupDb = db;
  return db;
}

test("cleanup deletes storage before pending rows and bounds the batch", async () => {
  const db = mock();
  assert.deepEqual(await cleanupExpiredRecruitment(), { removed: 1 });
  assert.deepEqual(db.events, ["lookup", "storage", "delete", "deleted"]);
});
test("empty cleanup makes no destructive calls", async () => {
  const db = mock({ rows: [] });
  assert.deepEqual(await cleanupExpiredRecruitment(), { removed: 0 });
  assert.deepEqual(db.events, ["lookup"]);
});
test("cleanup failures stop admission and never discard rows after failed object removal", async () => {
  for (const failure of ["lookupError", "storageError", "deleteError"]) {
    const db = mock({ [failure]: true });
    await assert.rejects(cleanupExpiredRecruitment);
    if (failure !== "deleteError") assert.equal(db.events.includes("delete"), false);
  }
});
