export const PDF_TEXT_NOTE_LIMITS = {
  maxNotes: 100,
  maxCharacters: 2000,
  maxBytes: 8000,
  maxLines: 20,
  minWidth: 0.08,
  maxWidth: 0.8,
  minHeight: 0.04,
  maxHeight: 0.6,
  minFontSizeRatio: 0.012,
  maxFontSizeRatio: 0.05,
} as const;

export type PdfTextNote = {
  page: number;
  sourceDocumentId: string;
  sourcePage: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSizeRatio: number;
};

export type PdfTextNoteSource = {
  id: string;
  pageCount: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const controlCharacterPattern = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const unsupportedWinAnsiPattern = /[^\n\u0020-\u007e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/u;
const exactKeys = [
  "fontSizeRatio", "height", "page", "sourceDocumentId", "sourcePage",
  "text", "width", "x", "y",
].sort();

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validatePdfTextNotes(
  value: unknown,
  sources: readonly PdfTextNoteSource[],
): string | null {
  if (!Array.isArray(value) || value.length > PDF_TEXT_NOTE_LIMITS.maxNotes) {
    return `Text notes must be an array with at most ${PDF_TEXT_NOTE_LIMITS.maxNotes} items.`;
  }
  const sourceOffsets = new Map<string, { pageCount: number; offset: number }>();
  let offset = 0;
  for (const source of sources) {
    if (!uuidPattern.test(source.id) || !Number.isInteger(source.pageCount) || source.pageCount < 1) {
      return "The PDF source manifest is invalid.";
    }
    sourceOffsets.set(source.id, { pageCount: source.pageCount, offset });
    offset += source.pageCount;
  }

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "A text note is invalid.";
    const note = raw as Record<string, unknown>;
    if (JSON.stringify(Object.keys(note).sort()) !== JSON.stringify(exactKeys)) return "A text note has invalid fields.";
    if (!Number.isInteger(note.page) || !Number.isInteger(note.sourcePage)
      || typeof note.sourceDocumentId !== "string" || !uuidPattern.test(note.sourceDocumentId)
      || typeof note.text !== "string"
      || !finite(note.x) || !finite(note.y) || !finite(note.width)
      || !finite(note.height) || !finite(note.fontSizeRatio)) {
      return "A text note has invalid values.";
    }
    const source = sourceOffsets.get(note.sourceDocumentId);
    if (!source || (note.sourcePage as number) < 1 || (note.sourcePage as number) > source.pageCount
      || note.page !== source.offset + (note.sourcePage as number)) {
      return "A text note has invalid page lineage.";
    }
    const characters = Array.from(note.text).length;
    const bytes = new TextEncoder().encode(note.text).byteLength;
    if (/^(?: |\n)|(?: |\n)$/u.test(note.text) || characters < 1
      || characters > PDF_TEXT_NOTE_LIMITS.maxCharacters
      || bytes > PDF_TEXT_NOTE_LIMITS.maxBytes
      || note.text.split("\n").length > PDF_TEXT_NOTE_LIMITS.maxLines
      || controlCharacterPattern.test(note.text)
      || unsupportedWinAnsiPattern.test(note.text)) {
      return "A text note has invalid text.";
    }
    if ((note.x as number) < 0 || (note.y as number) < 0
      || (note.width as number) < PDF_TEXT_NOTE_LIMITS.minWidth
      || (note.width as number) > PDF_TEXT_NOTE_LIMITS.maxWidth
      || (note.height as number) < PDF_TEXT_NOTE_LIMITS.minHeight
      || (note.height as number) > PDF_TEXT_NOTE_LIMITS.maxHeight
      || (note.fontSizeRatio as number) < PDF_TEXT_NOTE_LIMITS.minFontSizeRatio
      || (note.fontSizeRatio as number) > PDF_TEXT_NOTE_LIMITS.maxFontSizeRatio
      || (note.x as number) + (note.width as number) > 1
      || (note.y as number) + (note.height as number) > 1) {
      return "A text note has invalid geometry.";
    }
  }
  return null;
}

export function parsePdfTextNotes(
  value: unknown,
  sources: readonly PdfTextNoteSource[],
): PdfTextNote[] {
  const error = validatePdfTextNotes(value, sources);
  if (error) throw new Error(error);
  return structuredClone(value as PdfTextNote[]);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function movePdfTextNote(note: PdfTextNote, dx: number, dy: number): PdfTextNote {
  return { ...note, x: clamp(note.x + dx, 0, 1 - note.width), y: clamp(note.y + dy, 0, 1 - note.height) };
}

export function resizePdfTextNote(note: PdfTextNote, dx: number, dy: number): PdfTextNote {
  const widthScale = (note.width + dx) / note.width;
  const heightScale = (note.height + dy) / note.height;
  const requestedScale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
    ? widthScale
    : heightScale;
  const minimumScale = Math.max(
    PDF_TEXT_NOTE_LIMITS.minWidth / note.width,
    PDF_TEXT_NOTE_LIMITS.minHeight / note.height,
    PDF_TEXT_NOTE_LIMITS.minFontSizeRatio / note.fontSizeRatio,
  );
  const maximumScale = Math.min(
    PDF_TEXT_NOTE_LIMITS.maxWidth / note.width,
    PDF_TEXT_NOTE_LIMITS.maxHeight / note.height,
    (1 - note.x) / note.width,
    (1 - note.y) / note.height,
    PDF_TEXT_NOTE_LIMITS.maxFontSizeRatio / note.fontSizeRatio,
  );
  const scale = clamp(requestedScale, minimumScale, maximumScale);
  return {
    ...note,
    width: note.width * scale,
    height: note.height * scale,
    fontSizeRatio: note.fontSizeRatio * scale,
  };
}
