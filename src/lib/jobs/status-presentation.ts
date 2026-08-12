import type { DeliveredPdfStatus, JobStatus } from "./types";

export const jobStatusBadgeClasses: Record<JobStatus, string> = {
  asignado: "border border-sky-400 bg-sky-950 text-sky-100",
  en_progreso: "border border-amber-400 bg-amber-950 text-amber-100",
  enviado_revision: "border border-violet-400 bg-violet-950 text-violet-100",
  aprobado: "border border-emerald-400 bg-emerald-950 text-emerald-100",
  listo_pagar: "border border-orange-400 bg-orange-950 text-orange-100",
  pagado: "border border-teal-400 bg-teal-950 text-teal-100",
};

export const deliveredPdfStatusClasses: Record<DeliveredPdfStatus, string> = {
  pending: "text-slate-300",
  current: "text-emerald-300",
  stale: "text-rose-300",
};
