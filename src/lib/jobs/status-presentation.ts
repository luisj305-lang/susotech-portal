import type { DeliveredPdfStatus, JobStatus } from "./types";

export const jobStatusBadgeClasses: Record<JobStatus, string> = {
  sin_asignar: "border border-black bg-white text-black",
  asignado: "border border-black bg-white text-black",
  en_revision: "border border-black bg-white text-black",
  aprobado: "border border-black bg-white text-black",
  facturado: "border border-black bg-white text-black",
  pagado: "border border-black bg-white text-black",
};

export const deliveredPdfStatusClasses: Record<DeliveredPdfStatus, string> = {
  pending: "text-black",
  current: "text-black",
  stale: "text-black",
};
