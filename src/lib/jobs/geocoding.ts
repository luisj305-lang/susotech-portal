import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeAddress } from "@/lib/maps/google-maps";
import { geocodeAddressCensusCore } from "@/lib/maps/census-geocoder-core";

export function jobGeocodingAddress(input: { address?: string | null; location?: string | null; postalCode?: string | null }) {
  return [input.address, input.location, input.postalCode, "USA"].map((value) => value?.trim()).filter(Boolean).join(", ");
}

export type CoordinateEnrichment =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; status: "skipped" | "not_found" | "request_failed" | "timeout" };

/**
 * Resolves and stores free Census coordinates for a job. Best-effort by
 * contract: an empty address or a failed lookup leaves existing coordinates
 * untouched (it never clears or blocks the caller).
 */
export async function enrichJobCoordinates(
  supabase: SupabaseClient,
  jobId: string,
  input: { address?: string | null; location?: string | null; postalCode?: string | null },
): Promise<CoordinateEnrichment> {
  const address = jobGeocodingAddress(input);
  if (!address) return { ok: false, status: "skipped" };
  const result = await geocodeAddressCensusCore(address);
  if (result.ok) {
    await supabase.from("jobs").update({
      latitude: result.latitude,
      longitude: result.longitude,
      coordinates_geocoded_at: new Date().toISOString(),
    }).eq("id", jobId);
    return { ok: true, latitude: result.latitude, longitude: result.longitude };
  }
  return { ok: false, status: result.reason };
}

export async function enrichJobPlaceId(
  supabase: SupabaseClient,
  jobId: string,
  input: { address?: string | null; location?: string | null; postalCode?: string | null },
) {
  const address = jobGeocodingAddress(input);
  if (!address) return { ok: false as const, status: "pending" as const };
  const result = await geocodeAddress(address);
  if (result.ok) {
    await supabase.from("jobs").update({ google_place_id: result.placeId, geocoding_status: "resolved", geocoded_at: new Date().toISOString() }).eq("id", jobId);
    return { ok: true as const, status: "resolved" as const, placeId: result.placeId };
  }
  const status = result.reason === "unavailable" ? "pending" : "failed";
  await supabase.from("jobs").update({ google_place_id: null, geocoding_status: status, geocoded_at: null }).eq("id", jobId);
  return { ok: false as const, status };
}
