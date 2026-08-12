export function getJobMapUrl(input: {
  address: string | null;
  location: string | null;
  projectMapUrl?: string | null;
}) {
  if (input.projectMapUrl?.trim()) return input.projectMapUrl.trim();

  const query = [input.address, input.location]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(", ");

  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;
}
