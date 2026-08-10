import type { WrappedPdfiumModule } from "@embedpdf/pdfium";

export type PdfDraft = {
  title: string;
  orderIdentifier: string | null;
  prismNumber: string | null;
  address: string | null;
  location: string | null;
  customerName: string | null;
  requestDate: string | null;
  jobType: string | null;
  description: string | null;
};

export type PdfPreview = {
  fields: PdfDraft;
  fileHash: string;
  pageCount: number;
  responsibleSuggestion: string | null;
};

let pdfiumPromise: Promise<WrappedPdfiumModule> | null = null;

function firstMatch(text: string, pattern: RegExp) {
  const value = text.match(pattern)?.[1]?.replace(/\s+/gu, " ").trim();
  return value || null;
}

function isoDate(value: string | null) {
  if (!value) return null;
  const [month, day, shortYear] = value.split("/").map(Number);
  const year = shortYear < 100 ? 2000 + shortYear : shortYear;
  if (!month || !day || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\p{L}/gu, (character) => character.toUpperCase());
}

function normalizeLocation(value: string | null) {
  if (!value) return null;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) return `${titleCase(parts[0])}, ${parts[1].toUpperCase()} ${parts.slice(2).join(" ")}`;
  return value.replace(/\s+,/gu, ",").replace(/,\s*/gu, ", ").trim();
}

export function extractOperationalFields(text: string, fileName: string): PdfPreview["fields"] & { responsibleSuggestion: string | null } {
  const title = fileName.replace(/\.pdf$/iu, "").trim().slice(0, 200);
  const prismNumber = firstMatch(text, /PRISM ID#\s*([A-Z0-9-]+)/iu);
  const addressLine = text.match(/Address\s*(.*?)\s*City\/State\/Zip\s*([^\r\n]+)/iu);
  const supervisor = firstMatch(text, /Supervisor Name\s*(.*?)\s+(?:Y6 SRO|Supervisor Cell|\r?\n)/iu);
  return {
    title,
    orderIdentifier: prismNumber,
    prismNumber,
    address: addressLine?.[1]?.replace(/\s+/gu, " ").trim() || null,
    location: normalizeLocation(addressLine?.[2]?.replace(/\s+/gu, " ").trim() || null),
    customerName: firstMatch(text, /(?:Customer Name|Client Name)\s*[:#]?\s*([^\r\n]+)/iu),
    requestDate: isoDate(firstMatch(text, /Request Date\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/iu)),
    jobType: firstMatch(text, /Job Type\s*([^\r\n]+)/iu),
    description: firstMatch(text, /(?:Include any network changes\)\s*)([\s\S]*?)\s*2\.\s*Leak Levels/iu),
    responsibleSuggestion: supervisor ? `Supervisor del documento: ${supervisor}` : null,
  };
}

async function loadPdfium(wasmBinary?: ArrayBuffer) {
  if (!pdfiumPromise) {
    pdfiumPromise = (async () => {
      const { init } = await import("@embedpdf/pdfium");
      const binary = wasmBinary ?? await fetch("/pdfium.wasm").then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar el analizador de PDF.");
        return response.arrayBuffer();
      });
      const instance = await init({ wasmBinary: binary });
      instance.PDFiumExt_Init();
      return instance;
    })();
  }
  return pdfiumPromise;
}

async function extractText(bytes: Uint8Array, wasmBinary?: ArrayBuffer) {
  const pdfium = await loadPdfium(wasmBinary);
  const filePointer = pdfium.pdfium.wasmExports.malloc(bytes.length);
  (pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8.set(bytes, filePointer);
  const documentPointer = pdfium.FPDF_LoadMemDocument(filePointer, bytes.length, "");
  if (!documentPointer) {
    pdfium.pdfium.wasmExports.free(filePointer);
    throw new Error("El archivo no contiene un PDF legible.");
  }
  try {
    const pageCount = pdfium.FPDF_GetPageCount(documentPointer);
    if (pageCount < 1) throw new Error("El PDF no contiene páginas.");
    const pages: string[] = [];
    for (let index = 0; index < pageCount; index += 1) {
      const pagePointer = pdfium.FPDF_LoadPage(documentPointer, index);
      if (!pagePointer) throw new Error(`No se pudo leer la página ${index + 1}.`);
      try {
        const textPointer = pdfium.FPDFText_LoadPage(pagePointer);
        if (!textPointer) throw new Error(`No se pudo analizar la página ${index + 1}.`);
        try {
          const characters = pdfium.FPDFText_CountChars(textPointer);
          if (characters <= 0) { pages.push(""); continue; }
          const bufferPointer = pdfium.pdfium.wasmExports.malloc((characters + 1) * 2);
          try {
            const written = pdfium.FPDFText_GetText(textPointer, 0, characters, bufferPointer);
            pages.push(written > 0 ? pdfium.pdfium.UTF16ToString(bufferPointer) : "");
          } finally {
            pdfium.pdfium.wasmExports.free(bufferPointer);
          }
        } finally {
          pdfium.FPDFText_ClosePage(textPointer);
        }
      } finally {
        pdfium.FPDF_ClosePage(pagePointer);
      }
    }
    return { text: pages.join("\n"), pageCount };
  } finally {
    pdfium.FPDF_CloseDocument(documentPointer);
    pdfium.pdfium.wasmExports.free(filePointer);
  }
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function extractPdfPreview(file: File, options: { wasmBinary?: ArrayBuffer } = {}): Promise<PdfPreview> {
  if (file.size <= 0 || file.size > 25 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("El PDF no es válido o supera 25 MB.");
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("El archivo no contiene un PDF válido.");
  const [{ text, pageCount }, fileHash] = await Promise.all([
    extractText(bytes, options.wasmBinary),
    sha256Hex(buffer),
  ]);
  const { responsibleSuggestion, ...fields } = extractOperationalFields(text, file.name);
  return { fields, responsibleSuggestion, fileHash, pageCount };
}

export async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}
