import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject } from "pdf-lib";
import { MAX_RESUME_BYTES, PublicApplicationError } from "./public-input";

export async function validateResumeBytes(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_RESUME_BYTES || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new PublicApplicationError("El archivo no es un PDF válido de hasta 10 MB.");
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new Error("Unsupported PDF");
    // Reject active payloads; this is structural validation, not an antivirus scanner.
    const forbiddenKeys = ["JS", "JavaScript", "AA", "OpenAction", "EmbeddedFiles", "RichMediaContent", "XFA"];
    const seen = new Set<PDFObject>();
    function inspect(object: PDFObject, depth = 0) {
      if (seen.has(object)) return;
      if (depth > 100 || seen.size > 100000) throw new Error("Complex PDF");
      seen.add(object);
      if (object instanceof PDFDict) {
        if (forbiddenKeys.some(key => object.has(PDFName.of(key)))) throw new Error("Active content");
        const action = object.get(PDFName.of("S"));
        if (action instanceof PDFName && ["Launch", "JavaScript", "SubmitForm", "ImportData"].includes(action.decodeText())) throw new Error("Active action");
        for (const [, value] of object.entries()) inspect(value, depth + 1);
      } else if (object instanceof PDFArray) {
        for (let index = 0; index < object.size(); index++) inspect(object.get(index), depth + 1);
      }
    }
    for (const [, object] of pdf.context.enumerateIndirectObjects()) inspect(object);
  } catch { throw new PublicApplicationError("Usa un PDF sin contraseña ni contenido interactivo, de hasta 100 páginas."); }
}
