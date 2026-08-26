import "server-only";

import { computeOptimizedRoundTripCore, geocodeAddressCore } from "./google-maps-core";

function serverApiKey() {
  return process.env.GOOGLE_MAPS_SERVER_API_KEY?.trim() ?? "";
}

export async function geocodeAddress(address: string) {
  const key = serverApiKey();
  if (!key) return { ok: false as const, reason: "unavailable" as const };
  return geocodeAddressCore(address, key);
}

export async function computeOptimizedRoundTrip(originPlaceId: string, intermediatePlaceIds: string[]) {
  const key = serverApiKey();
  if (!key) return null;
  return computeOptimizedRoundTripCore(originPlaceId, intermediatePlaceIds, key);
}
