import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyImportOutcome, createImportRows, filterImportRows, importProgress,
  pageRows, selectUploadTargets,
} from "../src/components/jobs/bulk-import-model.ts";

let checks = 0;
function check(condition, label) {
  assert.ok(condition, label);
  checks += 1;
}

const files = [
  new File(["%PDF-one"], "Confirmed.pdf", { type: "application/pdf", lastModified: 1 }),
  new File(["%PDF-two"], "Duplicate.pdf", { type: "application/pdf", lastModified: 2 }),
  new File(["%PDF-three"], "Retry.pdf", { type: "application/pdf", lastModified: 3 }),
];
const initial = createImportRows(files).map((row) => ({ ...row, state: "pending" }));
check(initial.length === 3 && initial.every((row) => row.selected), "product model preserves all selected files");
check(selectUploadTargets(initial, false).length === 3, "initial upload includes all pending files");

let mixed = applyImportOutcome(initial, initial[0].key, { status: "imported", jobId: "job-confirmed", message: "Importado." });
mixed = applyImportOutcome(mixed, initial[1].key, { status: "duplicate", jobId: "job-existing", message: "Duplicado." });
mixed = applyImportOutcome(mixed, initial[2].key, { status: "error", message: "No se pudo subir el PDF." });
check(mixed.map((row) => row.state).join(",") === "imported,duplicate,error", "mixed outcomes remain independent");
check(importProgress(mixed).percent === 100, "all terminal outcomes complete general progress");
check(selectUploadTargets(mixed, true).length === 1 && selectUploadTargets(mixed, true)[0].file.name === "Retry.pdf", "retry includes only errors");

const completed = applyImportOutcome(mixed, initial[2].key, { status: "imported", jobId: "job-retried", message: "Importado." });
check(selectUploadTargets(completed, true).length === 0, "confirmed and duplicate rows are never retried");
check(new Set(completed.map((row) => row.jobId)).size === 3, "result rows retain distinct confirmed job identities");
check(filterImportRows(completed, "duplicate", "all").length === 1, "filename search filters rows");
check(filterImportRows(mixed, "", "error").length === 1, "state filter isolates failures");

const many = createImportRows(Array.from({ length: 120 }, (_, index) => new File([`%PDF-${index}`], `Order-${index}.pdf`)));
check(pageRows(many, 1).rows.length === 50 && pageRows(many, 3).rows.length === 20, "pagination renders at most fifty rows");

const ui = readFileSync(new URL("../src/components/jobs/bulk-import.tsx", import.meta.url), "utf8");
for (const pattern of [
  /onDrop=/u, /multiple/u, /extractPdfPreview/u, /mapWithConcurrency\(additions, 2/u,
  /mapWithConcurrency\(remaining, 3/u, /uploadToSignedUrl/u, /prepareBulkProjectUpload/u, /confirmBulkProjectUpload/u,
  /assignJobsInBulk/u, /Asignación masiva/u, /Reintentar fallidos/u, /Reintentar asignaciones/u, /responsibleSuggestion/u,
]) {
  check(pattern.test(ui), `bulk UI misses ${pattern}`);
}
check(!ui.includes("service_role"), "browser code has no privileged credential");
check(!ui.includes("createSignedUploadUrl") && !ui.includes("confirmProjectPdfImport"), "browser uses only metadata actions for authorization and confirmation");

console.log(`[bulk-import-ui] PASS checks=${checks} rows=${completed.length} page_size=50`);
