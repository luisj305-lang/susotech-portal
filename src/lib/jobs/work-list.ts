import type { ManualJob } from "@/lib/manual-jobs/types";
import { currentNewYorkPayrollPeriod, newYorkDateString } from "@/lib/time/new-york-week";

export const manualStatusLabels = { pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado" } as const;
export const manualFilterLabels = { "manual:pending": "Manual: pendiente", "manual:approved": "Manual: aprobado", "manual:rejected": "Manual: rechazado" };

// These are display entries, not assignments or financial allocations.
export function combineWorkItems<T extends { id: string }>(jobs: T[], manualJobs: ManualJob[]) {
  return [
    ...jobs.map((job) => ({ source: "regular" as const, key: `regular:${job.id}`, job })),
    ...manualJobs.map((job) => ({ source: "manual" as const, key: `manual:${job.id}`, job })),
  ];
}

export function manualJobHref(id: string): string {
  return `/manual#manual-${encodeURIComponent(id)}`;
}

export function isInWorkWeek(timestamp: string | null, referenceAt: Date): boolean {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return false;
  const { periodStart, periodEndExclusive } = currentNewYorkPayrollPeriod(referenceAt);
  const date = newYorkDateString(new Date(timestamp));
  return date >= periodStart && date < periodEndExclusive;
}

export function manualJobsForWorkerWeek(jobs: ManualJob[], technicianId: string, start: string, end: string): ManualJob[] {
  return jobs.filter((job) => job.workers.some((worker) => worker.technicianId === technicianId)
    && Date.parse(job.created_at) >= Date.parse(start) && Date.parse(job.created_at) < Date.parse(end));
}

export function filterManualWork(jobs: ManualJob[], filters: {
  query?: string; status?: string; tab?: string; archived?: boolean; facturados?: boolean; referenceAt?: Date;
} = {}): ManualJob[] {
  if (filters.archived || filters.facturados) return [];
  const query = filters.query?.trim().toLocaleLowerCase("es") ?? "";
  // Review/approval filters group equivalent outcomes without rewriting native statuses.
  const status = filters.status === "en_revision" ? "pending"
    : filters.status === "aprobado" ? "approved" : filters.status?.replace(/^manual:/, "");
  return jobs.filter((job) => (!query || job.prism_number.toLocaleLowerCase("es").includes(query))
    && (!status || job.status === status)
    && (filters.tab !== "activos" || job.status === "pending")
    && (filters.tab !== "revisados" || job.status !== "pending")
    && (!filters.referenceAt || isInWorkWeek(job.created_at, filters.referenceAt)));
}
