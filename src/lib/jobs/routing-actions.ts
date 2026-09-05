"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { computeOptimizedRoundTrip, geocodeAddress } from "@/lib/maps/google-maps";
import { enrichJobCoordinates, enrichJobPlaceId } from "./geocoding";
import { normalizeRouteJobIds, orderRouteRows } from "./route-planning-core";

type Result<T> = { success: true; message: string; data: T } | { success: false; message: string };

export async function saveRouteOrigin(input: { originAddress: string }): Promise<Result<{ originAddress: string }>> {
  const profile = await requireAdmin();
  const originAddress = input.originAddress?.trim();
  if (!originAddress || originAddress.length > 500) return { success: false, message: "Ingresa una dirección de origen válida." };
  const geocoded = await geocodeAddress(originAddress);
  if (!geocoded.ok) return { success: false, message: "Google no pudo resolver el origen. Revisa la dirección e inténtalo nuevamente." };
  const { error } = await (await createClient()).from("job_route_settings").upsert({
    id: true,
    origin_address: originAddress,
    origin_place_id: geocoded.placeId,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) return { success: false, message: "No se pudo guardar el origen." };
  revalidatePath("/trabajos/ruta");
  return { success: true, message: "Origen guardado.", data: { originAddress } };
}

export async function optimizeJobRoute(input: { jobIds: string[] }): Promise<Result<{
  orderedJobs: Array<{ id: string; label: string; address: string; postalCode: string | null }>;
  distanceMeters: number;
  duration: string;
}>> {
  await requireAdmin();
  const jobIds = normalizeRouteJobIds(input.jobIds);
  if (!jobIds) return { success: false, message: "Selecciona entre 1 y 25 trabajos activos sin repetir." };
  const supabase = await createClient();
  const [settings, jobs] = await Promise.all([
    supabase.from("job_route_settings").select("origin_place_id").eq("id", true).maybeSingle(),
    supabase.from("job_route_candidates").select("id,prism_number,title,address,location,postal_code,google_place_id")
      .in("id", jobIds),
  ]);
  if (settings.error || !settings.data?.origin_place_id) return { success: false, message: "Guarda primero una dirección de origen." };
  if (jobs.error || (jobs.data ?? []).length !== jobIds.length) return { success: false, message: "Uno o más trabajos ya no están activos o disponibles." };
  const byId = new Map((jobs.data ?? []).map((job) => [job.id, job]));
  const selected = jobIds.map((id) => byId.get(id)!);

  for (const job of selected) {
    if (job.google_place_id) continue;
    const enriched = await enrichJobPlaceId(supabase, job.id, { address: job.address, location: job.location, postalCode: job.postal_code });
    if (enriched.ok) job.google_place_id = enriched.placeId;
  }
  const unresolved = selected.filter((job) => !job.google_place_id);
  if (unresolved.length) return { success: false, message: `Google no pudo ubicar ${unresolved.length} trabajo(s). Corrige sus direcciones o ZIP y vuelve a intentar.` };

  // Free Census coordinates for every selected job (best-effort, never blocks).
  for (const job of selected) {
    try {
      await enrichJobCoordinates(supabase, job.id, { address: job.address, location: job.location, postalCode: job.postal_code });
    } catch {
      // Best-effort.
    }
  }

  const route = await computeOptimizedRoundTrip(settings.data.origin_place_id, selected.map((job) => job.google_place_id!));
  if (!route) return { success: false, message: "Google Routes no pudo optimizar el recorrido en este momento." };
  const ordered = orderRouteRows(selected, route.optimizedIntermediateWaypointIndex);
  if (!ordered) return { success: false, message: "Google devolvió un orden de ruta inválido." };
  revalidatePath("/trabajos/ruta");
  return {
    success: true,
    message: "Ruta optimizada. El resultado no se guarda en el portal.",
    data: {
      orderedJobs: ordered.map((job) => ({
        id: job.id,
        label: job.prism_number || job.title || job.address || "Trabajo sin nombre",
        address: [job.address, job.location, job.postal_code].filter(Boolean).join(", "),
        postalCode: job.postal_code,
      })),
      distanceMeters: route.distanceMeters,
      duration: route.duration,
    },
  };
}
