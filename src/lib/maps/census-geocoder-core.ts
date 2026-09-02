export type CensusGeocodeResult =
  | { ok: true; latitude: number; longitude: number; matchedAddress: string }
  | { ok: false; reason: "not_found" | "request_failed" | "timeout" };

const CENSUS_GEOCODER_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; json: unknown; timedOut: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
    const json = await response.json().catch(() => null);
    return { ok: response.ok, json, timedOut: false };
  } catch (error) {
    return { ok: false, json: null, timedOut: error instanceof Error && error.name === "AbortError" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Free, key-less geocoding via the US Census Bureau Geocoder.
 *
 * Returns latitude/longitude for a single US address line (street + city +
 * state + ZIP, as produced by `jobGeocodingAddress`). No API key or billing
 * is required; see https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html
 */
export async function geocodeAddressCensusCore(
  address: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<CensusGeocodeResult> {
  const normalized = address.trim();
  if (!normalized) return { ok: false, reason: "request_failed" };

  const url = new URL(CENSUS_GEOCODER_ENDPOINT);
  url.searchParams.set("address", normalized);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const response = await requestJson(fetchImpl, url.toString(), {
    method: "GET",
    headers: { "User-Agent": "susotech-portal/1.0" },
  }, timeoutMs);
  if (!response.ok) return { ok: false, reason: response.timedOut ? "timeout" : "request_failed" };

  const body = response.json as {
    result?: {
      addressMatches?: Array<{
        coordinates?: { x?: unknown; y?: unknown };
        matchedAddress?: unknown;
      }>;
    };
  } | null;

  const match = body?.result?.addressMatches?.[0];
  // Census returns longitude in `x` and latitude in `y`.
  const longitude = Number(match?.coordinates?.x);
  const latitude = Number(match?.coordinates?.y);
  const matchedAddress = typeof match?.matchedAddress === "string" ? match.matchedAddress : "";

  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, latitude, longitude, matchedAddress };
}
