import "server-only";

import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type RouteCandidate = {
  id: string;
  label: string;
  address: string;
  postalCode: string | null;
  geocodingStatus: "pending" | "resolved" | "failed";
};

export async function getRoutePlannerData() {
  await requireAdmin();
  const supabase = await createClient();
  const [jobs, settings] = await Promise.all([
    supabase.from("job_route_candidates").select("id,prism_number,title,address,location,postal_code,geocoding_status")
      .order("deadline_date", { ascending: true, nullsFirst: false }),
    supabase.from("job_route_settings").select("origin_address,updated_at").eq("id", true).maybeSingle(),
  ]);
  if (jobs.error || settings.error) throw new Error("No se pudo cargar el planificador de rutas.");
  return {
    candidates: (jobs.data ?? []).filter((job) => job.address || job.location).map((job): RouteCandidate => ({
      id: job.id,
      label: job.prism_number || job.title || job.address || "Trabajo sin nombre",
      address: [job.address, job.location, job.postal_code].filter(Boolean).join(", "),
      postalCode: job.postal_code,
      geocodingStatus: job.geocoding_status,
    })),
    originAddress: settings.data?.origin_address ?? "",
  };
}
