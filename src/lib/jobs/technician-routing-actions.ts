"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { computeTechnicianRoute, serverApiKey } from "@/lib/maps/google-maps";
import { geocodeAddressCensusCore } from "@/lib/maps/census-geocoder-core";
import { jobGeocodingAddress } from "./geocoding";
import { listTechnicianJobs } from "./queries";
import { normalizeRouteJobIds, orderRouteRows } from "./route-planning-core";

export type OrderedTechnicianJob = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
};

export type SkippedTechnicianJob = {
  id: string;
  label: string;
};

export type OptimizeTechnicianRouteResult =
  | {
      success: true;
      orderedJobs: OrderedTechnicianJob[];
      skipped: SkippedTechnicianJob[];
      distanceMeters: number;
      duration: string;
    }
  | { success: false; message: string };

function isValidOrigin(origin: { latitude: number; longitude: number }): boolean {
  return (
    Number.isFinite(origin.latitude)
    && Number.isFinite(origin.longitude)
    && origin.latitude >= -90
    && origin.latitude <= 90
    && origin.longitude >= -180
    && origin.longitude <= 180
  );
}

export async function optimizeTechnicianRoute(input: {
  jobIds: string[];
  origin: { latitude: number; longitude: number };
}): Promise<OptimizeTechnicianRouteResult> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") return { success: false, message: "No autorizado." };

  const jobIds = normalizeRouteJobIds(input.jobIds);
  if (!jobIds) return { success: false, message: "Selecciona entre 1 y 25 trabajos válidos sin repetir." };

  if (!input.origin || !isValidOrigin(input.origin)) {
    return { success: false, message: "Ubicación actual inválida." };
  }

  // Authorize every requested id against the RLS-visible pending set. A
  // requested id outside that set (tampered or changed status) is rejected.
  const pending = await listTechnicianJobs({ status: "asignado" });
  const pendingById = new Map(pending.map((job) => [job.id, job]));
  if (jobIds.some((id) => !pendingById.has(id))) {
    return { success: false, message: "Uno o más trabajos ya no están disponibles." };
  }

  if (!serverApiKey()) {
    return {
      success: false,
      message: "La ruta de Google Maps no está disponible todavía. Configura la clave de Google Maps para usarla.",
    };
  }

  const supabase = await createClient();
  const skipped: SkippedTechnicianJob[] = [];
  const waypoints: Array<{ id: string; label: string; address: string; lat: number; lng: number }> = [];

  for (const id of jobIds) {
    const job = pendingById.get(id)!;
    if (job.latitude != null && job.longitude != null) {
      waypoints.push({
        id: job.id,
        label: job.prism_number || job.title || job.address || "Trabajo sin nombre",
        address: [job.address, job.location].filter(Boolean).join(", "),
        lat: job.latitude,
        lng: job.longitude,
      });
      continue;
    }

    // Enrich missing coordinates: geocode with the free Census geocoder, then
    // persist through the SECURITY DEFINER RPC (bypasses the technician write
    // trigger). Any failure here excludes the job and surfaces it.
    const address = jobGeocodingAddress({ address: job.address, location: job.location });
    const geocoded = address
      ? await geocodeAddressCensusCore(address)
      : { ok: false as const, reason: "not_found" as const };
    if (geocoded.ok) {
      const { error } = await supabase.rpc("enrich_job_coordinates_technician", {
        p_job_id: job.id,
        p_latitude: geocoded.latitude,
        p_longitude: geocoded.longitude,
      });
      if (!error) {
        waypoints.push({
          id: job.id,
          label: job.prism_number || job.title || job.address || "Trabajo sin nombre",
          address: [job.address, job.location].filter(Boolean).join(", "),
          lat: geocoded.latitude,
          lng: geocoded.longitude,
        });
        continue;
      }
    }

    skipped.push({ id: job.id, label: job.prism_number || job.title || job.address || "Trabajo sin nombre" });
  }

  if (waypoints.length < 1) {
    return { success: false, message: "No se pudieron ubicar los trabajos seleccionados." };
  }

  const route = await computeTechnicianRoute(
    { latitude: input.origin.latitude, longitude: input.origin.longitude },
    { latitude: input.origin.latitude, longitude: input.origin.longitude },
    waypoints.map((waypoint) => ({ latitude: waypoint.lat, longitude: waypoint.lng })),
  );
  if (!route) return { success: false, message: "Google Routes no pudo optimizar el recorrido en este momento." };

  const ordered = orderRouteRows(waypoints, route.optimizedIntermediateWaypointIndex);
  if (!ordered) return { success: false, message: "Google devolvió un orden de ruta inválido." };

  revalidatePath("/trabajos/mi-ruta");

  return {
    success: true,
    orderedJobs: ordered.map((waypoint) => ({
      id: waypoint.id,
      label: waypoint.label,
      address: waypoint.address,
      lat: waypoint.lat,
      lng: waypoint.lng,
    })),
    skipped,
    distanceMeters: route.distanceMeters,
    duration: route.duration,
  };
}
