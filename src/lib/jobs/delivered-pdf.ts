import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import sharp from "sharp";

const RASTER_DPI = 180;
const MAX_SOURCE_PAGES = 50;
const MAX_EVIDENCE_PHOTOS = 30;
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_RASTER_PIXELS = 20_000_000;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const ORIGINAL_JPEG_QUALITY = 90;
const EVIDENCE_MAX_EDGE = 2400;

export type DeliveredPdfEvidence = {
  id: string;
  bytes: Uint8Array;
  createdAt?: string | null;
  technicianName?: string | null;
  comment?: string | null;
};

export type DeliveredPdfResult = {
  bytes: Uint8Array;
  pageCount: number;
  originalPageCount: number;
  sourcePhotoIds: string[];
};

let pdfiumPromise: Promise<WrappedPdfiumModule> | null = null;
let compositionTail: Promise<void> = Promise.resolve();

async function loadPdfium() {
  if (!pdfiumPromise) {
    pdfiumPromise = (async () => {
      const [{ init }, wasmBinary] = await Promise.all([
        import("@embedpdf/pdfium"),
        readFile(path.join(process.cwd(), "public", "pdfium.wasm")),
      ]);
      const instance = await init({ wasmBinary });
      instance.PDFiumExt_Init();
      return instance;
    })();
  }
  return pdfiumPromise;
}

function openDocument(pdfium: WrappedPdfiumModule, bytes: Uint8Array) {
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("El documento original no es un PDF válido.");
  }
  const pointer = pdfium.pdfium.wasmExports.malloc(bytes.length);
  (pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, pointer);
  const document = pdfium.FPDF_LoadMemDocument(pointer, bytes.length, "");
  if (!document) {
    pdfium.pdfium.wasmExports.free(pointer);
    throw new Error(`PDFium no pudo abrir el documento (código ${pdfium.FPDF_GetLastError()}).`);
  }
  return { document, pointer };
}

function closeDocument(
  pdfium: WrappedPdfiumModule,
  opened: { document: number; pointer: number },
) {
  pdfium.FPDF_CloseDocument(opened.document);
  pdfium.pdfium.wasmExports.free(opened.pointer);
}

function renderPage(pdfium: WrappedPdfiumModule, document: number, pageIndex: number) {
  const page = pdfium.FPDF_LoadPage(document, pageIndex);
  if (!page) throw new Error(`PDFium no pudo leer la página ${pageIndex + 1}.`);
  try {
    const pointsWidth = pdfium.FPDF_GetPageWidthF(page);
    const pointsHeight = pdfium.FPDF_GetPageHeightF(page);
    if (!Number.isFinite(pointsWidth) || !Number.isFinite(pointsHeight) || pointsWidth <= 0 || pointsHeight <= 0) {
      throw new Error(`La página ${pageIndex + 1} tiene dimensiones inválidas.`);
    }
    const requestedScale = RASTER_DPI / 72;
    const pixelScale = Math.min(
      requestedScale,
      Math.sqrt(MAX_RASTER_PIXELS / (pointsWidth * pointsHeight)),
    );
    const width = Math.max(1, Math.round(pointsWidth * pixelScale));
    const height = Math.max(1, Math.round(pointsHeight * pixelScale));
    const bitmap = pdfium.FPDFBitmap_Create(width, height, 1);
    if (!bitmap) throw new Error(`PDFium no pudo rasterizar la página ${pageIndex + 1}.`);
    try {
      pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
      pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0x01 | 0x08);
      const stride = pdfium.FPDFBitmap_GetStride(bitmap);
      const bufferPointer = pdfium.FPDFBitmap_GetBuffer(bitmap);
      const heap = (pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
      const source = heap.slice(bufferPointer, bufferPointer + stride * height);
      const rgba = Buffer.allocUnsafe(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const sourceOffset = y * stride + x * 4;
          const targetOffset = (y * width + x) * 4;
          rgba[targetOffset] = source[sourceOffset + 2];
          rgba[targetOffset + 1] = source[sourceOffset + 1];
          rgba[targetOffset + 2] = source[sourceOffset];
          rgba[targetOffset + 3] = source[sourceOffset + 3];
        }
      }
      return { rgba, width, height, pointsWidth, pointsHeight };
    } finally {
      pdfium.FPDFBitmap_Destroy(bitmap);
    }
  } finally {
    pdfium.FPDF_ClosePage(page);
  }
}

function asciiText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[^\x20-\x7e]/gu, "?")
    .replace(/\s+/gu, " ")
    .trim();
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number, maxLines: number) {
  const words = asciiText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const candidate = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      if (lines.length) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
    } else {
      if (lines.length >= maxLines) break;
      lines.push(word);
    }
  }
  if (words.length && lines.length === maxLines) {
    while (font.widthOfTextAtSize(`${lines[maxLines - 1]}...`, size) > maxWidth) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1);
    }
    lines[maxLines - 1] += "...";
  }
  return lines;
}

function drawCaption(page: PDFPage, font: PDFFont, photo: DeliveredPdfEvidence, index: number, margin: number) {
  const lines = [`Evidencia ${index + 1}`];
  if (photo.createdAt) {
    const date = new Date(photo.createdAt);
    if (!Number.isNaN(date.getTime())) {
      lines.push(`Fecha: ${date.toLocaleString("es-US", { timeZone: "America/New_York" })}`);
    }
  }
  if (photo.technicianName?.trim()) lines.push(`Tecnico: ${photo.technicianName}`);
  const maxWidth = page.getWidth() - margin * 2;
  if (photo.comment?.trim()) {
    lines.push(...wrapText(`Comentario: ${photo.comment}`, font, 10, maxWidth, 3));
  }
  lines.slice(0, 6).forEach((line, lineIndex) => {
    page.drawText(asciiText(line), {
      x: margin,
      y: margin + (lines.length - lineIndex - 1) * 14,
      size: lineIndex === 0 ? 11 : 10,
      font,
      color: rgb(0.12, 0.12, 0.12),
    });
  });
  return Math.min(6, lines.length) * 14 + 12;
}

async function composeUnlocked(
  originalPdf: Uint8Array,
  evidence: DeliveredPdfEvidence[],
): Promise<DeliveredPdfResult> {
  if (!originalPdf.length || originalPdf.length > MAX_ORIGINAL_BYTES) {
    throw new Error("El PDF original supera el límite de 25 MB.");
  }
  if (!evidence.length) throw new Error("Se requiere al menos una evidencia confirmada.");
  if (evidence.length > MAX_EVIDENCE_PHOTOS) throw new Error(`El máximo es ${MAX_EVIDENCE_PHOTOS} evidencias por entrega.`);
  if (evidence.some((photo) => !photo.bytes.length || photo.bytes.length > MAX_EVIDENCE_BYTES)) {
    throw new Error("Una evidencia supera el límite de 10 MB.");
  }

  const pdfium = await loadPdfium();
  const source = openDocument(pdfium, originalPdf);
  const output = await PDFDocument.create();
  let originalPageCount = 0;
  try {
    originalPageCount = pdfium.FPDF_GetPageCount(source.document);
    if (originalPageCount < 1 || originalPageCount > MAX_SOURCE_PAGES) {
      throw new Error(`El PDF original debe tener entre 1 y ${MAX_SOURCE_PAGES} páginas.`);
    }
    for (let index = 0; index < originalPageCount; index += 1) {
      const rendered = renderPage(pdfium, source.document, index);
      const jpeg = await sharp(rendered.rgba, {
        raw: { width: rendered.width, height: rendered.height, channels: 4 },
      }).flatten({ background: "#ffffff" }).jpeg({
        quality: ORIGINAL_JPEG_QUALITY,
        mozjpeg: true,
        chromaSubsampling: "4:4:4",
      }).toBuffer();
      const image = await output.embedJpg(jpeg);
      const page = output.addPage([rendered.pointsWidth, rendered.pointsHeight]);
      page.drawImage(image, { x: 0, y: 0, width: rendered.pointsWidth, height: rendered.pointsHeight });
    }
  } finally {
    closeDocument(pdfium, source);
  }

  const font = await output.embedFont(StandardFonts.Helvetica);
  for (const [index, photo] of evidence.entries()) {
    const inputImage = sharp(photo.bytes, { limitInputPixels: 40_000_000, failOn: "error" });
    const inputMetadata = await inputImage.metadata();
    if (!inputMetadata.format || !["jpeg", "png", "webp"].includes(inputMetadata.format)) {
      throw new Error(`La evidencia ${index + 1} debe ser JPEG, PNG o WebP.`);
    }
    const normalized = await inputImage
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: EVIDENCE_MAX_EDGE, height: EVIDENCE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const metadata = await sharp(normalized).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`La evidencia ${index + 1} no es una imagen válida.`);
    const landscape = metadata.width > metadata.height * 1.15;
    const page = output.addPage(landscape ? [792, 612] : [612, 792]);
    const image = await output.embedJpg(normalized);
    const margin = 36;
    const captionHeight = drawCaption(page, font, photo, index, margin);
    const availableWidth = page.getWidth() - margin * 2;
    const availableHeight = page.getHeight() - margin * 2 - captionHeight;
    const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (page.getWidth() - width) / 2,
      y: margin + captionHeight + (availableHeight - height) / 2,
      width,
      height,
    });
  }

  const bytes = await output.save({ useObjectStreams: false });
  if (bytes.length > MAX_OUTPUT_BYTES) throw new Error("El PDF entregado supera el límite de 100 MB.");

  const verification = openDocument(pdfium, bytes);
  try {
    const pageCount = pdfium.FPDF_GetPageCount(verification.document);
    if (pageCount !== originalPageCount + evidence.length) throw new Error("El PDF entregado tiene un número de páginas inválido.");
    for (let index = 0; index < pageCount; index += 1) {
      const page = pdfium.FPDF_LoadPage(verification.document, index);
      if (!page) throw new Error(`No se pudo validar la página ${index + 1} del PDF entregado.`);
      pdfium.FPDF_ClosePage(page);
    }
    return {
      bytes,
      pageCount,
      originalPageCount,
      sourcePhotoIds: evidence.map((photo) => photo.id).sort(),
    };
  } finally {
    closeDocument(pdfium, verification);
  }
}

export async function composeDeliveredPdf(
  originalPdf: Uint8Array,
  evidence: DeliveredPdfEvidence[],
) {
  const previous = compositionTail;
  let release!: () => void;
  compositionTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await composeUnlocked(originalPdf, evidence);
  } finally {
    release();
  }
}
