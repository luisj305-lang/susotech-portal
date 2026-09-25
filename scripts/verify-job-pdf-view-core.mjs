import assert from "node:assert/strict";
import {
  PDF_VIEWER_SIGNED_URL_TTL_SECONDS,
  parseJobPdfViewKind,
  resolveJobPdfViewStoragePath,
} from "../src/lib/jobs/pdf-view-core.ts";

const jobId = "11111111-1111-4111-8111-111111111111";
const job = {
  project_pdf_url: `${jobId}/original.pdf`,
  delivered_pdf_path: `${jobId}/delivered/current.pdf`,
};

assert.equal(parseJobPdfViewKind("original"), "original");
assert.equal(parseJobPdfViewKind("delivered"), "delivered");
assert.equal(parseJobPdfViewKind("attachment"), null);
assert.equal(parseJobPdfViewKind("../../original"), null);
assert.equal(resolveJobPdfViewStoragePath(jobId, "original", job), job.project_pdf_url);
assert.equal(resolveJobPdfViewStoragePath(jobId, "delivered", job), job.delivered_pdf_path);
assert.equal(resolveJobPdfViewStoragePath(jobId, "original", { ...job, project_pdf_url: "other-job/original.pdf" }), null);
assert.equal(resolveJobPdfViewStoragePath(jobId, "delivered", { ...job, delivered_pdf_path: null }), null);
assert.ok(PDF_VIEWER_SIGNED_URL_TTL_SECONDS >= 5 * 60 && PDF_VIEWER_SIGNED_URL_TTL_SECONDS <= 30 * 60);

console.log(JSON.stringify({
  result: "PASS",
  viewerUrlSeconds: PDF_VIEWER_SIGNED_URL_TTL_SECONDS,
  rejectedKinds: ["attachment", "../../original"],
}));
