export type GeocodeResult =
  | { ok: true; placeId: string }
  | { ok: false; reason: "not_found" | "ambiguous" | "request_failed" | "timeout" };

export type OptimizedRoute = {
  optimizedIntermediateWaypointIndex: number[];
  distanceMeters: number;
  duration: string;
};

export type LatLngWaypoint = {
  latitude: number;
  longitude: number;
};

function isValidLatLng(waypoint: LatLngWaypoint): boolean {
  return (
    Number.isFinite(waypoint.latitude)
    && Number.isFinite(waypoint.longitude)
    && waypoint.latitude >= -90
    && waypoint.latitude <= 90
    && waypoint.longitude >= -180
    && waypoint.longitude <= 180
  );
}

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

export async function geocodeAddressCore(
  address: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<GeocodeResult> {
  const normalized = address.trim();
  if (!normalized || !apiKey) return { ok: false, reason: "request_failed" };
  const url = new URL(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(normalized)}`);
  url.searchParams.set("regionCode", "us");
  const response = await requestJson(fetchImpl, url.toString(), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "results.placeId",
    },
  }, timeoutMs);
  if (!response.ok) return { ok: false, reason: response.timedOut ? "timeout" : "request_failed" };
  const results = (response.json as { results?: Array<{ placeId?: unknown }> } | null)?.results ?? [];
  const placeIds = results.map((result) => result.placeId).filter((value): value is string => typeof value === "string" && value.length > 0);
  if (placeIds.length === 0) return { ok: false, reason: "not_found" };
  if (placeIds.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, placeId: placeIds[0] };
}

export async function computeOptimizedRoundTripCore(
  originPlaceId: string,
  intermediatePlaceIds: string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12_000,
): Promise<OptimizedRoute | null> {
  if (!apiKey || !originPlaceId || intermediatePlaceIds.length < 1 || intermediatePlaceIds.length > 25) return null;
  const response = await requestJson(fetchImpl, "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { placeId: originPlaceId },
      destination: { placeId: originPlaceId },
      intermediates: intermediatePlaceIds.map((placeId) => ({ placeId })),
      travelMode: "DRIVE",
      optimizeWaypointOrder: true,
    }),
  }, timeoutMs);
  if (!response.ok) return null;
  const route = (response.json as { routes?: Array<Record<string, unknown>> } | null)?.routes?.[0];
  if (!route || !Number.isFinite(Number(route.distanceMeters)) || typeof route.duration !== "string") return null;
  const indexes = Array.isArray(route.optimizedIntermediateWaypointIndex)
    ? route.optimizedIntermediateWaypointIndex.map(Number)
    : [];
  if (indexes.length !== intermediatePlaceIds.length || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= intermediatePlaceIds.length)) return null;
  return {
    optimizedIntermediateWaypointIndex: indexes,
    distanceMeters: Number(route.distanceMeters),
    duration: route.duration,
  };
}

/**
 * Optimized round-trip over raw latitude/longitude waypoints (no Place ID),
 * used by the technician GPS route. Same field mask, `requestJson`, and
 * `optimizedIntermediateWaypointIndex` validation as
 * `computeOptimizedRoundTripCore`, but origin/destination/intermediates are
 * `location.latLng` objects instead of Place IDs.
 */
export async function computeOptimizedRouteLatLngCore(
  origin: LatLngWaypoint,
  destination: LatLngWaypoint,
  intermediates: LatLngWaypoint[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12_000,
): Promise<OptimizedRoute | null> {
  if (
    !apiKey
    || !isValidLatLng(origin)
    || !isValidLatLng(destination)
    || intermediates.length < 1
    || intermediates.length > 25
    || intermediates.some((waypoint) => !isValidLatLng(waypoint))
  ) return null;

  const response = await requestJson(fetchImpl, "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
      destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
      intermediates: intermediates.map((waypoint) => ({
        location: { latLng: { latitude: waypoint.latitude, longitude: waypoint.longitude } },
      })),
      travelMode: "DRIVE",
      optimizeWaypointOrder: true,
    }),
  }, timeoutMs);
  if (!response.ok) return null;
  const route = (response.json as { routes?: Array<Record<string, unknown>> } | null)?.routes?.[0];
  if (!route || !Number.isFinite(Number(route.distanceMeters)) || typeof route.duration !== "string") return null;
  const indexes = Array.isArray(route.optimizedIntermediateWaypointIndex)
    ? route.optimizedIntermediateWaypointIndex.map(Number)
    : [];
  if (indexes.length !== intermediates.length || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= intermediates.length)) return null;
  return {
    optimizedIntermediateWaypointIndex: indexes,
    distanceMeters: Number(route.distanceMeters),
    duration: route.duration,
  };
}
