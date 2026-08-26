import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import sharp from "sharp";

const RASTER_DPI = 180;
const MAX_SOURCE_PAGES = 100;
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

export type DeliveredPdfCodePlacement = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  quantity: number;
  arrowTipX: number;
  arrowTipY: number;
  code: string;
  color: string;
};

export type DeliveredPdfTextNote = {
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizeRatio: number;
  arrowTipX?: number;
  arrowTipY?: number;
};

export type DeliveredPdfLine = {
  page: number;
  points: { x: number; y: number }[];
  color: string;
};

export type DeliveredPdfSource = {
  id: string;
  bytes: Uint8Array;
};

export type DeliveredPdfResult = {
  bytes: Uint8Array;
  pageCount: number;
  originalPageCount: number;
  sourceDocumentIds: string[];
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
    // Flatten annotations into the page content so they render reliably in the
    // raster; the FPDF_ANNOT flag alone misses annotations without appearance streams.
    pdfium.FPDFPage_Flatten(page, 0);
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
      pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0x00);
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

function assertWinAnsiText(value: string, font: PDFFont) {
  try { font.encodeText(value); }
  catch { throw new Error("Una nota contiene caracteres que Helvetica no puede representar."); }
  return value;
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
  sourceDocuments: DeliveredPdfSource[],
  evidence: DeliveredPdfEvidence[],
  codes: DeliveredPdfCodePlacement[] = [],
  textNotes: DeliveredPdfTextNote[] = [],
  lines: DeliveredPdfLine[] = [],
): Promise<DeliveredPdfResult> {
  if (!sourceDocuments.length || sourceDocuments.some((source) => !source.bytes.length || source.bytes.length > MAX_ORIGINAL_BYTES)) {
    throw new Error("Cada PDF fuente debe existir y no superar 25 MB.");
  }
  if (!evidence.length) throw new Error("Se requiere al menos una evidencia confirmada.");
  if (evidence.length > MAX_EVIDENCE_PHOTOS) throw new Error(`El máximo es ${MAX_EVIDENCE_PHOTOS} evidencias por entrega.`);
  if (evidence.some((photo) => !photo.bytes.length || photo.bytes.length > MAX_EVIDENCE_BYTES)) {
    throw new Error("Una evidencia supera el límite de 10 MB.");
  }

  const pdfium = await loadPdfium();
  const output = await PDFDocument.create();
  const codeFont = await output.embedFont(StandardFonts.HelveticaBold);
  const noteFont = await output.embedFont(StandardFonts.Helvetica);
  let originalPageCount = 0;
  let originalPageWidth = 0;
  let originalPageHeight = 0;
  for (const sourceDocument of sourceDocuments) {
    const source = openDocument(pdfium, sourceDocument.bytes);
    try {
      const sourcePageCount = pdfium.FPDF_GetPageCount(source.document);
      if (sourcePageCount < 1 || originalPageCount + sourcePageCount > MAX_SOURCE_PAGES) {
        throw new Error(`El conjunto de PDFs debe tener entre 1 y ${MAX_SOURCE_PAGES} páginas.`);
      }
      for (let index = 0; index < sourcePageCount; index += 1) {
        const combinedPage = originalPageCount + index + 1;
        const rendered = renderPage(pdfium, source.document, index);
        if (originalPageWidth === 0) {
          originalPageWidth = rendered.pointsWidth;
          originalPageHeight = rendered.pointsHeight;
        }
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
      for (const line of lines.filter((item) => item.page === combinedPage)) {
        const hex = line.color.replace("#", "");
        const color = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
        for (let index = 0; index < line.points.length - 1; index += 1) {
          const start = line.points[index];
          const end = line.points[index + 1];
          page.drawLine({
            start: { x: start.x * rendered.pointsWidth, y: rendered.pointsHeight - start.y * rendered.pointsHeight },
            end: { x: end.x * rendered.pointsWidth, y: rendered.pointsHeight - end.y * rendered.pointsHeight },
            thickness: 3,
            color,
          });
        }
      }
      for (const note of textNotes.filter((item) => item.page === combinedPage)) {
        const x = note.x * rendered.pointsWidth;
        const width = note.width * rendered.pointsWidth;
        const height = note.height * rendered.pointsHeight;
        const y = rendered.pointsHeight - (note.y * rendered.pointsHeight) - height;
        const size = note.fontSizeRatio * rendered.pointsWidth;
        const lineHeight = size * 1.2;
        const lines = note.text.split("\n").map((line) => assertWinAnsiText(line, noteFont));
        if (lines.length * lineHeight > height || lines.some((line) => noteFont.widthOfTextAtSize(line, size) > width)) {
          throw new Error("Una nota de texto no cabe dentro de su cuadro.");
        }
        const noteTipX = note.arrowTipX;
        const noteTipY = note.arrowTipY;
        if (typeof noteTipX === "number" && Number.isFinite(noteTipX) && typeof noteTipY === "number" && Number.isFinite(noteTipY)) {
          const startX = (note.x + note.width / 2) * rendered.pointsWidth;
          const startY = rendered.pointsHeight - ((note.y + note.height / 2) * rendered.pointsHeight);
          const tipX = noteTipX * rendered.pointsWidth;
          const tipY = rendered.pointsHeight - (noteTipY * rendered.pointsHeight);
          const noteColor = rgb(0, 0, 0);
          page.drawLine({ start: { x: startX, y: startY }, end: { x: tipX, y: tipY }, thickness: 2, color: noteColor });
          const angle = Math.atan2(tipY - startY, tipX - startX);
          const arrowLength = Math.max(8, Math.min(18, rendered.pointsWidth * 0.018));
          for (const offset of [-Math.PI / 7, Math.PI / 7]) {
            page.drawLine({
              start: { x: tipX, y: tipY },
              end: {
                x: tipX - arrowLength * Math.cos(angle + offset),
                y: tipY - arrowLength * Math.sin(angle + offset),
              },
              thickness: 2,
              color: noteColor,
            });
          }
        }
        page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1, opacity: 1, borderOpacity: 1 });
        lines.forEach((line, lineIndex) => {
          if (line) page.drawText(line, { x, y: y + height - size - lineIndex * lineHeight, size, font: noteFont, color: rgb(0.05, 0.05, 0.05) });
        });
      }
      for (const placement of codes.filter((item) => item.page === combinedPage)) {
        const hex = placement.color.replace("#", "");
        const color = rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
        const x = placement.x * rendered.pointsWidth;
        const width = placement.width * rendered.pointsWidth;
        const height = placement.height * rendered.pointsHeight;
        const y = rendered.pointsHeight - (placement.y * rendered.pointsHeight) - height;
        const startX = (placement.x + placement.width / 2) * rendered.pointsWidth;
        const startY = rendered.pointsHeight - ((placement.y + placement.height / 2) * rendered.pointsHeight);
        const tipX = placement.arrowTipX * rendered.pointsWidth;
        const tipY = rendered.pointsHeight - (placement.arrowTipY * rendered.pointsHeight);
        page.drawLine({ start: { x: startX, y: startY }, end: { x: tipX, y: tipY }, thickness: 2.5, color });
        const angle = Math.atan2(tipY - startY, tipX - startX);
        const arrowLength = Math.max(8, Math.min(18, rendered.pointsWidth * 0.018));
        for (const offset of [-Math.PI / 7, Math.PI / 7]) {
          page.drawLine({
            start: { x: tipX, y: tipY },
            end: {
              x: tipX - arrowLength * Math.cos(angle + offset),
              y: tipY - arrowLength * Math.sin(angle + offset),
            },
            thickness: 2.5,
            color,
          });
        }
        page.drawRectangle({
          x,
          y,
          width,
          height,
          color: rgb(1, 1, 1),
          borderColor: color,
          borderWidth: 2,
          opacity: 1,
          borderOpacity: 1,
        });
        const placementText = `${asciiText(placement.code)} × ${placement.quantity}`.slice(0, 36);
        const horizontalPadding = Math.min(3, width * 0.08);
        const heightBoundSize = Math.max(1, height * 0.48);
        const availableTextWidth = Math.max(1, width - horizontalPadding * 2);
        const naturalTextWidth = codeFont.widthOfTextAtSize(placementText, heightBoundSize);
        const fittedTextSize = Math.max(1, Math.min(
          heightBoundSize,
          naturalTextWidth > 0 ? heightBoundSize * availableTextWidth / naturalTextWidth : heightBoundSize,
        ));
        page.drawText(placementText, {
          x: x + horizontalPadding,
          y: y + Math.max(1, (height - fittedTextSize) / 2),
          size: fittedTextSize,
          font: codeFont,
          color: rgb(0, 0, 0),
        });
      }
    }
      originalPageCount += sourcePageCount;
    } finally {
      closeDocument(pdfium, source);
    }
  }

  if (codes.some((item) => !Number.isInteger(item.page) || item.page < 1 || item.page > originalPageCount
    || !Number.isFinite(item.quantity) || item.quantity <= 0
    || item.x < 0 || item.y < 0 || item.width <= 0 || item.height <= 0 || item.x + item.width > 1 || item.y + item.height > 1
    || item.arrowTipX < 0 || item.arrowTipX > 1 || item.arrowTipY < 0 || item.arrowTipY > 1)) {
    throw new Error("El borrador contiene códigos fuera de las páginas o bordes del PDF.");
  }
  if (textNotes.some((item) => !Number.isInteger(item.page) || item.page < 1 || item.page > originalPageCount
    || !item.text || item.x < 0 || item.y < 0 || item.width < 0.08 || item.width > 0.8
    || item.height < 0.04 || item.height > 0.6 || item.x + item.width > 1 || item.y + item.height > 1
    || item.fontSizeRatio < 0.012 || item.fontSizeRatio > 0.05)) {
    throw new Error("El borrador contiene notas fuera de las páginas o bordes del PDF.");
  }
  if (lines.some((item) => !Number.isInteger(item.page) || item.page < 1 || item.page > originalPageCount
    || !Array.isArray(item.points) || item.points.length < 2 || item.points.length > 50
    || item.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1))) {
    throw new Error("El borrador contiene líneas fuera de las páginas o bordes del PDF.");
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
    const page = output.addPage([originalPageWidth || 612, originalPageHeight || 792]);
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
      sourceDocumentIds: sourceDocuments.map((source) => source.id),
      sourcePhotoIds: evidence.map((photo) => photo.id).sort(),
    };
  } finally {
    closeDocument(pdfium, verification);
  }
}

export async function composeDeliveredPdf(
  sourceDocuments: DeliveredPdfSource[],
  evidence: DeliveredPdfEvidence[],
  codes: DeliveredPdfCodePlacement[] = [],
  textNotes: DeliveredPdfTextNote[] = [],
  lines: DeliveredPdfLine[] = [],
) {
  const previous = compositionTail;
  let release!: () => void;
  compositionTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await composeUnlocked(sourceDocuments, evidence, codes, textNotes, lines);
  } finally {
    release();
  }
}

export async function inspectPdfDocument(bytes: Uint8Array) {
  const previous = compositionTail;
  let release!: () => void;
  compositionTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    if (!bytes.length || bytes.length > MAX_ORIGINAL_BYTES) throw new Error("El PDF supera el límite de 25 MB.");
    const pdfium = await loadPdfium();
    const source = openDocument(pdfium, bytes);
    try {
      const pageCount = pdfium.FPDF_GetPageCount(source.document);
      if (pageCount < 1 || pageCount > MAX_SOURCE_PAGES) throw new Error("El PDF tiene un número de páginas inválido.");
      for (let index = 0; index < pageCount; index += 1) {
        const page = pdfium.FPDF_LoadPage(source.document, index);
        if (!page) throw new Error(`PDFium no pudo leer la página ${index + 1}.`);
        pdfium.FPDF_ClosePage(page);
      }
      return { pageCount };
    } finally {
      closeDocument(pdfium, source);
    }
  } finally {
    release();
  }
}

export async function renderOriginalPdfPreview(originalPdf: Uint8Array, pageNumber: number) {
  const previous = compositionTail;
  let release!: () => void;
  compositionTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    if (!originalPdf.length || originalPdf.length > MAX_ORIGINAL_BYTES) throw new Error("El PDF original supera el límite de 25 MB.");
    const pdfium = await loadPdfium();
    const source = openDocument(pdfium, originalPdf);
    try {
      const pageCount = pdfium.FPDF_GetPageCount(source.document);
      if (pageCount < 1 || pageCount > MAX_SOURCE_PAGES || pageNumber < 1 || pageNumber > pageCount) throw new Error("La página solicitada no es válida.");
      const rendered = renderPage(pdfium, source.document, pageNumber - 1);
      const png = await sharp(rendered.rgba, { raw: { width: rendered.width, height: rendered.height, channels: 4 } }).png().toBuffer();
      return { png, pageCount, width: rendered.width, height: rendered.height };
    } finally { closeDocument(pdfium, source); }
  } finally { release(); }
}
