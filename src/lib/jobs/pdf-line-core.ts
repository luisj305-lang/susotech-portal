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

const RIGHT_ANGLE_TOLERANCE_DEGREES = 15;
const COLLINEAR_TOLERANCE_DEGREES = 15;
const DP_EPSILON_FACTOR = 2.5;

function distanceBetween(start: PdfLinePoint, end: PdfLinePoint): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function perpendicularDistance(point: PdfLinePoint, start: PdfLinePoint, end: PdfLinePoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceBetween(point, start);
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return distanceBetween(point, { x: start.x + clamped * dx, y: start.y + clamped * dy });
}

function radialFilter(points: readonly PdfLinePoint[], minDistance: number): PdfLinePoint[] {
  const result: PdfLinePoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index += 1) {
    const last = result[result.length - 1];
    if (distanceBetween(points[index], last) >= minDistance) result.push({ ...points[index] });
  }
  result.push({ ...points[points.length - 1] });
  return result;
}

function douglasPeucker(points: readonly PdfLinePoint[], epsilon: number): PdfLinePoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  let maxDistance = 0;
  let index = 0;
  for (let current = 1; current < points.length - 1; current += 1) {
    const distance = perpendicularDistance(points[current], points[0], points[points.length - 1]);
    if (distance > maxDistance) { maxDistance = distance; index = current; }
  }
  if (maxDistance > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [{ ...points[0] }, { ...points[points.length - 1] }];
}

function angleBetween(start: PdfLinePoint, corner: PdfLinePoint, end: PdfLinePoint): number {
  const ux = corner.x - start.x;
  const uy = corner.y - start.y;
  const vx = end.x - corner.x;
  const vy = end.y - corner.y;
  const dot = ux * vx + uy * vy;
  const magnitude = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (magnitude === 0) return 180;
  const cosine = Math.max(-1, Math.min(1, dot / magnitude));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function snapRightAngles(points: readonly PdfLinePoint[], toleranceDegrees: number): PdfLinePoint[] {
  const result = points.map((point) => ({ ...point }));
  for (let index = 1; index < result.length - 1; index += 1) {
    const start = result[index - 1];
    const corner = result[index];
    const end = result[index + 1];
    if (Math.abs(angleBetween(start, corner, end) - 90) > toleranceDegrees) continue;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const radius = distanceBetween(start, end) / 2;
    const dx = corner.x - midX;
    const dy = corner.y - midY;
    const offset = Math.hypot(dx, dy);
    if (offset > 1e-9) {
      result[index] = { x: midX + (dx / offset) * radius, y: midY + (dy / offset) * radius };
    }
  }
  return result;
}

function removeCollinear(points: readonly PdfLinePoint[], toleranceDegrees: number): PdfLinePoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const result: PdfLinePoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (angleBetween(points[index - 1], points[index], points[index + 1]) >= toleranceDegrees) {
      result.push({ ...points[index] });
    }
  }
  result.push({ ...points[points.length - 1] });
  return result;
}

export function simplifyLine(points: readonly PdfLinePoint[], minDistance: number): PdfLinePoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const filtered = radialFilter(points, minDistance);
  const simplified = douglasPeucker(filtered, minDistance * DP_EPSILON_FACTOR);
  const straightened = removeCollinear(simplified, COLLINEAR_TOLERANCE_DEGREES);
  return snapRightAngles(straightened, RIGHT_ANGLE_TOLERANCE_DEGREES);
}
