import "server-only";

import { listTechnicianJobs } from "./queries";

export type TechnicianRouteJob = {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Pending (`asignado`, not archived) jobs visible to the current technician
 * via RLS, ordered by `deadline_date` ascending. Reuses the same RLS-scoped
 * `listTechnicianJobs` query as the technician jobs list.
 */
export async function getTechnicianRouteData(): Promise<TechnicianRouteJob[]> {
  const jobs = await listTechnicianJobs({ status: "asignado" });
  return jobs.map((job) => ({
    id: job.id,
    label: job.prism_number || job.title || job.address || "Trabajo sin nombre",
    address: [job.address, job.location].filter(Boolean).join(", "),
    latitude: job.latitude ?? null,
    longitude: job.longitude ?? null,
  }));
}
