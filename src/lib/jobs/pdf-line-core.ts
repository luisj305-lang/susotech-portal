import { CODE_COLOR_OPTIONS } from "./pdf-code-editor-core";

export const PDF_LINE_LIMITS = {
  maxLines: 100,
  minPoints: 2,
  maxPoints: 50,
} as const;

export type PdfLinePoint = { x: number; y: number };

export type PdfLineAnnotation = {
  page: number;
  sourceDocumentId: string;
  sourcePage: number;
  points: PdfLinePoint[];
  color: string;
};

export type PdfLineSource = {
  id: string;
  pageCount: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requiredKeys = ["page", "sourceDocumentId", "sourcePage", "points", "color"];
const allowedKeys = [...requiredKeys];
const pointKeys = ["x", "y"];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validatePdfLines(
  value: unknown,
  sources: readonly PdfLineSource[],
): string | null {
  if (!Array.isArray(value) || value.length > PDF_LINE_LIMITS.maxLines) {
    return `Lines must be an array with at most ${PDF_LINE_LIMITS.maxLines} items.`;
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
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "A line is invalid.";
    const line = raw as Record<string, unknown>;
    const lineKeys = Object.keys(line);
    if (!requiredKeys.every((key) => lineKeys.includes(key))) return "A line is missing required fields.";
    if (!lineKeys.every((key) => allowedKeys.includes(key))) return "A line has invalid fields.";
    if (!Number.isInteger(line.page) || !Number.isInteger(line.sourcePage)
      || typeof line.sourceDocumentId !== "string" || !uuidPattern.test(line.sourceDocumentId)
      || !Array.isArray(line.points)
      || line.points.length < PDF_LINE_LIMITS.minPoints || line.points.length > PDF_LINE_LIMITS.maxPoints
      || typeof line.color !== "string" || !(CODE_COLOR_OPTIONS as readonly string[]).includes(line.color)) {
      return "A line has invalid values.";
    }
    const source = sourceOffsets.get(line.sourceDocumentId);
    if (!source || (line.sourcePage as number) < 1 || (line.sourcePage as number) > source.pageCount
      || line.page !== source.offset + (line.sourcePage as number)) {
      return "A line has invalid page lineage.";
    }
    for (const rawPoint of line.points as readonly unknown[]) {
      if (!rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) return "A line point is invalid.";
      const point = rawPoint as Record<string, unknown>;
      const keys = Object.keys(point);
      if (!pointKeys.every((key) => keys.includes(key)) || !keys.every((key) => pointKeys.includes(key))) {
        return "A line point has invalid fields.";
      }
      if (!finite(point.x) || !finite(point.y)
        || (point.x as number) < 0 || (point.x as number) > 1
        || (point.y as number) < 0 || (point.y as number) > 1) {
        return "A line point is out of bounds.";
      }
    }
  }
  return null;
}

export function parsePdfLines(
  value: unknown,
  sources: readonly PdfLineSource[],
): PdfLineAnnotation[] {
  const error = validatePdfLines(value, sources);
  if (error) throw new Error(error);
  return structuredClone(value as PdfLineAnnotation[]);
}

export function simplifyLine(points: readonly PdfLinePoint[], minDistance: number): PdfLinePoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const result: PdfLinePoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index += 1) {
    const last = result[result.length - 1];
    if (Math.hypot(points[index].x - last.x, points[index].y - last.y) >= minDistance) {
      result.push({ ...points[index] });
    }
  }
  const tail = points[points.length - 1];
  result.push({ ...tail });
  return result;
}
