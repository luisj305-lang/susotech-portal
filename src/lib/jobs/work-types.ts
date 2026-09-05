// Approved work-type catalog (R08). These ten values are the complete set of
// selectable work types; legacy free-text `job_type` values are preserved
// as-is and are not part of this catalog.
export const WORK_TYPES = [
  "Aerial splicing",
  "Underground splicing",
  "Riser",
  "Aerial construcción",
  "Pull fiber/coax",
  "PT",
  "Lash/case/tap",
  "DeRe",
  "Wreckout",
  "Nuevo Projecto",
] as const;

export type WorkType = (typeof WORK_TYPES)[number];

const WORK_TYPE_SET = new Set<string>(WORK_TYPES);

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// Resolves the labels to display for a job. Prefers the `work_types` array
// when present and non-empty; otherwise falls back to the legacy scalar
// `job_type`; otherwise returns an empty list.
export function workTypeLabels(job: {
  job_type: string | null;
  work_types?: string[] | null;
}): string[] {
  const fromArray = dedupe(
    (job.work_types ?? []).map((value) => value.trim()).filter(Boolean),
  );
  if (fromArray.length > 0) return fromArray;
  const scalar = job.job_type?.trim() ?? "";
  return scalar ? [scalar] : [];
}

// Validates a raw value (e.g. `FormData.getAll("workType")`) into a cleaned,
// order-preserving, deduped list of catalog types. Throws a Spanish error on
// invalid or empty input. Intended for the create/update write path; the
// server action wiring is deferred until `actions.ts` is unblocked.
export function cleanWorkTypes(values: unknown): string[] {
  if (!Array.isArray(values)) throw new Error("El tipo de trabajo no es válido.");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") throw new Error("El tipo de trabajo no es válido.");
    const type = value.trim();
    if (!WORK_TYPE_SET.has(type)) throw new Error("El tipo de trabajo no es válido.");
    if (!seen.has(type)) {
      seen.add(type);
      result.push(type);
    }
  }
  if (result.length === 0) throw new Error("Selecciona al menos un tipo de trabajo.");
  return result;
}
