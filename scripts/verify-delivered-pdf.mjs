import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const repo = process.cwd();
const originalPath = process.env.DELIVERED_PDF_FIXTURE ?? path.join(os.homedir(), "Downloads", "6556114.pdf");
const evidencePath = process.env.DELIVERED_PHOTO_FIXTURE ?? path.join(os.tmpdir(), "susotech-pdf-spike", "evidence-original");
if (!existsSync(originalPath) || !existsSync(evidencePath)) {
  throw new Error("Set DELIVERED_PDF_FIXTURE and DELIVERED_PHOTO_FIXTURE to real local fixtures.");
}

const scratch = path.join(repo, "tmp", "pdfs", `verify-${process.pid}-${randomBytes(4).toString("hex")}`);
const modulePath = path.join(scratch, "delivered-pdf.ts");
const outputPath = path.join(os.tmpdir(), "susotech-pdf-spike", "delivered-pdf-production-check.pdf");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function renderedPageStats(pdfBytes, pageIndex, renderPath) {
  const { init } = await import("@embedpdf/pdfium");
  const wasmBinary = await readFile(path.join(repo, "public", "pdfium.wasm"));
  const pdfium = await init({ wasmBinary });
  pdfium.PDFiumExt_Init();
  const pointer = pdfium.pdfium.wasmExports.malloc(pdfBytes.length);
  pdfium.pdfium.HEAPU8.set(pdfBytes, pointer);
  const document = pdfium.FPDF_LoadMemDocument(pointer, pdfBytes.length, "");
  if (!document) throw new Error("PDFium could not reopen the delivered PDF.");
  try {
    const page = pdfium.FPDF_LoadPage(document, pageIndex);
    if (!page) throw new Error(`PDFium could not load delivered page ${pageIndex + 1}.`);
    try {
      const width = 900;
      const height = Math.round(width * pdfium.FPDF_GetPageHeightF(page) / pdfium.FPDF_GetPageWidthF(page));
      const bitmap = pdfium.FPDFBitmap_Create(width, height, 1);
      try {
        pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0x01 | 0x08);
        const stride = pdfium.FPDFBitmap_GetStride(bitmap);
        const bufferPointer = pdfium.FPDFBitmap_GetBuffer(bitmap);
        const bgra = pdfium.pdfium.HEAPU8.slice(bufferPointer, bufferPointer + stride * height);
        const rgba = Buffer.alloc(width * height * 4);
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          const source = y * stride + x * 4;
          const target = (y * width + x) * 4;
          rgba[target] = bgra[source + 2];
          rgba[target + 1] = bgra[source + 1];
          rgba[target + 2] = bgra[source];
          rgba[target + 3] = bgra[source + 3];
        }
        const image = sharp(rgba, { raw: { width, height, channels: 4 } });
        await image.clone().png().toFile(renderPath);
        return image.stats();
      } finally {
        pdfium.FPDFBitmap_Destroy(bitmap);
      }
    } finally {
      pdfium.FPDF_ClosePage(page);
    }
  } finally {
    pdfium.FPDF_CloseDocument(document);
    pdfium.pdfium.wasmExports.free(pointer);
  }
}

await mkdir(scratch, { recursive: true });
try {
  const source = await readFile(path.join(repo, "src", "lib", "jobs", "delivered-pdf.ts"), "utf8");
  await writeFile(modulePath, source.replace(/import "server-only";\r?\n/u, ""));
  const { composeDeliveredPdf } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
  const original = await readFile(originalPath);
  const originalHash = hash(original);
  const evidence = await readFile(evidencePath);
  const delivered = await composeDeliveredPdf(original, [{
    id: "2ee76113-4e5f-4e6f-b520-2036fa73fd59",
    bytes: evidence,
    createdAt: "2026-08-10T00:00:00.000Z",
    technicianName: "Tecnico de prueba",
    comment: "Evidencia real de validacion",
  }]);
  await writeFile(outputPath, delivered.bytes);
  const reopened = await PDFDocument.load(delivered.bytes);
  const renderPath = path.join(os.tmpdir(), "susotech-pdf-spike", "delivered-pdf-evidence-page.png");
  const stats = await renderedPageStats(delivered.bytes, delivered.pageCount - 1, renderPath);
  const visible = stats.channels.slice(0, 3).some((channel) => channel.stdev > 20);
  const originalUnchanged = hash(await readFile(originalPath)) === originalHash;
  if (!originalUnchanged || !visible || reopened.getPageCount() !== delivered.pageCount) {
    throw new Error("Delivered PDF validation failed.");
  }
  console.log(JSON.stringify({
    result: "PASS",
    originalPages: delivered.originalPageCount,
    deliveredPages: delivered.pageCount,
    evidenceVisible: visible,
    originalUnchanged,
    outputPath,
    renderPath,
    outputBytes: delivered.bytes.length,
  }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
