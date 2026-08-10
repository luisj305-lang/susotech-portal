import assert from "node:assert/strict";
import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createImportRows, filterImportRows, importProgress, pageRows, selectUploadTargets } from "../src/components/jobs/bulk-import-model.ts";
import { extractPdfPreview, mapWithConcurrency } from "../src/lib/jobs/pdf-parser.ts";

let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

const sourceBytes = await readFile("C:/Users/goofy/Downloads/6556114.pdf");
const wasmBytes = await readFile(new URL("../public/pdfium.wasm", import.meta.url));
const wasmBinary = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);
const validFiles = [
  new File([sourceBytes], "6556114.pdf", { type: "application/pdf" }),
  new File([sourceBytes], "orden-copia.pdf", { type: "application/pdf" }),
];
const previews = [];
await mapWithConcurrency(validFiles, 2, async (file, index) => {
  previews[index] = await extractPdfPreview(file, { wasmBinary });
});

const real = previews[0];
check(real.pageCount === 3, "real PDF exposes three physical pages");
check(real.fields.orderIdentifier === "6556114", "real PRISM identifier extracted");
check(real.fields.prismNumber === "6556114", "PRISM field extracted");
check(real.fields.requestDate === "2026-02-10", "request date normalized");
check(real.fields.address === "1587 ShallCross Ave", "street address extracted");
check(real.fields.location === "Orlando, FL 32826", "city/state/zip normalized");
check(real.fields.jobType === "Span Replacement", "job type extracted");
check(real.fields.description?.startsWith("Please replace 200ft of .625"), "work description extracted");
check(real.fields.customerName === null, "customer remains empty without an explicit field");
check(real.responsibleSuggestion === "Supervisor del documento: Wilfredo B.", "responsible person remains a suggestion");
check(/^[a-f0-9]{64}$/u.test(real.fileHash), "SHA-256 produced");
check(previews[1].fileHash === real.fileHash, "same bytes produce same duplicate-protection hash");

await assert.rejects(
  () => extractPdfPreview(new File(["not a pdf"], "malo.pdf", { type: "application/pdf" }), { wasmBinary }),
  /PDF válido/u,
);
checks += 1;

const manyFiles = Array.from({ length: 120 }, (_, index) => new File(["%PDF-1.4"], `orden-${index}.pdf`, { type: "application/pdf" }));
const rows = createImportRows(manyFiles).map((row, index) => ({
  ...row,
  state: index % 3 === 0 ? "error" : "pending",
  fields: { ...row.fields, orderIdentifier: String(index) },
}));
check(rows.length === 120, "hundreds are not truncated");
check(selectUploadTargets(rows, true).length === 40, "retry selects only errors");
check(filterImportRows(rows, "orden-11", "all").length === 11, "search filters rows");
check(filterImportRows(rows, "", "error").length === 40, "state filter works");
const pagination = pageRows(rows, 2);
check(pagination.rows.length === 50 && pagination.pages === 3, "fifty-row pagination works");
const progress = importProgress(rows.map((row, index) => ({ ...row, state: index < 20 ? "imported" : row.state })));
check(progress.total === 120 && progress.complete > 20, "general progress counts terminal states");

console.log(`[bulk-pdf-parser] PASS checks=${checks} valid_files=${validFiles.length} rows=${rows.length}`);
