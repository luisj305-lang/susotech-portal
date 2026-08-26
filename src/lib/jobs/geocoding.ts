import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeAddress } from "@/lib/maps/google-maps";

export function jobGeocodingAddress(input: { address?: string | null; location?: string | null; postalCode?: string | null }) {
  return [input.address, input.location, input.postalCode, "USA"].map((value) => value?.trim()).filter(Boolean).join(", ");
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
