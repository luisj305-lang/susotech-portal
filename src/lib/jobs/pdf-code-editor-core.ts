export type PdfCodeEntry = {
  catalogId: string;
  quantity: number;
};

export type PdfCodePlacement = {
  id: string;
  page: number;
  sourceDocumentId: string;
  sourcePage: number;
  entries: PdfCodeEntry[];
  x: number;
  y: number;
  width: number;
  height: number;
  arrowTipX: number;
  arrowTipY: number;
  color?: string;
};

export type PdfCodeDraft = { version: number; sourcePageCount: number; placements: PdfCodePlacement[] };

export const CODE_COLOR_OPTIONS = ["#dc2626", "#d946ef", "#eab308", "#000000", "#f97316", "#2563eb"] as const;
export const DEFAULT_CODE_COLOR = "#000000";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function placementsOverlap(a: PdfCodePlacement, b: PdfCodePlacement) {
  return a.page === b.page && a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function validatePlacements(placements: PdfCodePlacement[], pageCount: number) {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 50 || placements.length > 500) return "Borrador inválido.";
  const ids = new Set<string>();
  for (const item of placements) {
    if (!uuidPattern.test(item.id) || ids.has(item.id)
      || !Number.isInteger(item.page) || item.page < 1 || item.page > pageCount
      || !uuidPattern.test(item.sourceDocumentId)
      || !Number.isInteger(item.sourcePage) || item.sourcePage < 1 || item.sourcePage > 500
      || !Array.isArray(item.entries) || item.entries.length < 1 || item.entries.length > 20
      || ![item.x, item.y, item.width, item.height, item.arrowTipX, item.arrowTipY].every(Number.isFinite)
      || item.x < 0 || item.y < 0 || item.width < 0.04 || item.width > 0.35
      || item.height < 0.025 || item.height > 0.2 || item.x + item.width > 1 || item.y + item.height > 1
      || item.arrowTipX < 0 || item.arrowTipX > 1 || item.arrowTipY < 0 || item.arrowTipY > 1
      || (item.color !== undefined && !CODE_COLOR_OPTIONS.includes(item.color as (typeof CODE_COLOR_OPTIONS)[number]))) {
      return "Hay un código fuera de los bordes permitidos.";
    }
    for (const entry of item.entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || !uuidPattern.test(entry.catalogId)
        || !Number.isFinite(entry.quantity) || entry.quantity <= 0
        || Math.round(entry.quantity * 100) !== entry.quantity * 100) {
        return "Hay un código con cantidad inválida.";
      }
    }
    ids.add(item.id);
  }
  for (let i = 0; i < placements.length; i += 1) for (let j = i + 1; j < placements.length; j += 1) {
    if (placementsOverlap(placements[i], placements[j])) return "Hay códigos superpuestos.";
  }
  return null;
}

export function clampPlacement(item: PdfCodePlacement): PdfCodePlacement {
  const width = Math.min(0.35, Math.max(0.04, item.width));
  const height = Math.min(0.2, Math.max(0.025, item.height));
  return {
    ...item,
    width,
    height,
    x: Math.min(1 - width, Math.max(0, item.x)),
    y: Math.min(1 - height, Math.max(0, item.y)),
    arrowTipX: Math.min(1, Math.max(0, item.arrowTipX)),
    arrowTipY: Math.min(1, Math.max(0, item.arrowTipY)),
  };
}

export function placementLabel(quantity: number, code: string) {
  return `${code} × ${Number(quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export const CODE_BOX_LINE_HEIGHT = 0.05;
export const CODE_BOX_MAX_HEIGHT = 0.2;

export function codeBoxHeight(entryCount: number) {
  return Math.min(CODE_BOX_MAX_HEIGHT, CODE_BOX_LINE_HEIGHT * Math.max(1, entryCount));
}
