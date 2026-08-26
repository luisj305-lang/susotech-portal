const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeRouteJobIds(jobIds: unknown) {
  if (!Array.isArray(jobIds)) return null;
  const unique = [...new Set(jobIds)];
  if (unique.length !== jobIds.length || unique.length < 1 || unique.length > 25 || unique.some((id) => typeof id !== "string" || !uuidPattern.test(id))) return null;
  return unique as string[];
}

export function orderRouteRows<T>(rows: T[], optimizedIndexes: number[]) {
  if (optimizedIndexes.length !== rows.length || new Set(optimizedIndexes).size !== rows.length) return null;
  const ordered = optimizedIndexes.map((index) => rows[index]);
  return ordered.some((row) => row === undefined) ? null : ordered;
}
