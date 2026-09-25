import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconInbox } from "@/components/ui/icons";
import type { Job } from "@/lib/jobs/types";
import { workTypeLabels } from "@/lib/jobs/work-types";
import { getJobMapUrl } from "@/lib/jobs/maps";
import { groupJobParts } from "@/lib/jobs/parts";
import type { ManualJob } from "@/lib/manual-jobs/types";
import { combineWorkItems, manualFilterLabels } from "@/lib/jobs/work-list";
import { ManualWorkCard } from "./manual-work-card";

const incidents: Record<string, string> = { need_splicing: "Requiere empalme", no_access: "Sin acceso", need_cr: "Requiere CR", permit_pending: "Permiso pendiente", returned: "Devuelto", incomplete: "Incompleto" };

const statusLabels: Record<string, string> = { asignado: "Asignado", en_revision: "En revisión", aprobado: "Aprobado" };

function technicianStatus(status: Job["main_status"]): Job["main_status"] {
  return status === "facturado" || status === "pagado" ? "aprobado" : status;
}

function tabHref(tab: string, query?: string, status?: string, weekOffset?: number) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  if (weekOffset !== undefined) params.set("week", String(weekOffset));
  return `/trabajos?${params.toString()}`;
}

function JobCard({ job }: { job: Job }) {
  const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url });
  return (
    <article className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">{job.prism_number ? `PRISM ${job.prism_number}` : job.address || job.location || "Sin número PRISM"}</h2>
        <div className="flex items-center gap-2">
          {job.partLabel && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-soft">{job.partLabel}</span>}
          <StatusBadge status={technicianStatus(job.main_status)} />
        </div>
      </div>
      {workTypeLabels(job).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {workTypeLabels(job).map((type) => (
            <span key={type} className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs text-ink-soft">{type}</span>
          ))}
        </div>
      ) : null}
      {mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-4 block text-base text-accent-600 underline">{job.address || job.location}</a> : <p className="mt-4 text-base text-ink-soft">Ubicación no indicada</p>}
      {job.deadline_date && <p className="mt-2 text-sm font-medium text-ink-soft">Fecha límite: {new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(job.deadline_date))}</p>}
      {job.incident && <p className="mt-3 rounded-lg border border-line bg-surface-muted p-3 font-semibold text-ink">Incidencia: {incidents[job.incident]}</p>}
      <Link href={`/trabajos/${job.id}`} className={`${buttonClasses({ variant: "secondary" })} mt-4`}>Ver trabajo</Link>
    </article>
  );
}

export function WorkJobCards({ jobs, manualJobs = [] }: { jobs: Job[]; manualJobs?: ManualJob[] }) {
  const groups = groupJobParts(jobs).map((group) => ({ ...group, id: group.root.id }));
  const entries = combineWorkItems(groups, manualJobs);
  return entries.length ? <div className="grid gap-4">
    {entries.map((entry) => entry.source === "manual"
      ? <ManualWorkCard key={entry.key} job={entry.job} />
      : <div key={entry.key} data-work-source="regular" className="grid gap-4">
        <JobCard job={entry.job.root} />
        {entry.job.children.length > 0 && <div className="grid gap-4 border-l-2 border-line pl-4">
          {entry.job.children.map((child) => <JobCard key={`regular:${child.id}`} job={child} />)}
        </div>}
      </div>)}
  </div> : <EmptyState icon={IconInbox} title="No hay trabajos que coincidan" description="Las asignaciones y los registros manuales aparecerán aquí." />;
}

export function JobList({ jobs, manualJobs = [], initialQuery = "", initialStatus = "", tab = "activos", weekOffset }: { jobs: Job[]; manualJobs?: ManualJob[]; initialQuery?: string; initialStatus?: string; tab?: string; weekOffset?: number }) {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href={weekOffset === undefined ? "/dashboard" : `/dashboard?week=${weekOffset}`} className="text-sm font-medium text-accent-600 hover:text-accent-500">← Dashboard</Link>
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Trabajo de campo</p>
        <h1 className="text-3xl font-bold text-ink">Mis trabajos</h1>
        <p className="mt-2 text-ink-soft">Órdenes asignadas y trabajos manuales en los que participas. Los manuales pendientes aparecen en Activos; los aprobados y rechazados, en Revisados.</p>
      </header>
      <nav aria-label="Vistas de trabajo" className="flex gap-2">
        <Link href={tabHref("activos", initialQuery, initialStatus, weekOffset)} aria-current={tab === "activos" ? "page" : undefined} className={buttonClasses({ variant: tab === "activos" ? "primary" : "secondary", size: "sm" })}>Activos</Link>
        <Link href={tabHref("revisados", initialQuery, initialStatus, weekOffset)} aria-current={tab === "revisados" ? "page" : undefined} className={buttonClasses({ variant: tab === "revisados" ? "primary" : "secondary", size: "sm" })}>Revisados</Link>
      </nav>
      <div className="grid gap-4 rounded-2xl border border-line bg-white p-4 shadow-card">
        <form className="flex flex-wrap items-end gap-2">
          {weekOffset !== undefined && <input type="hidden" name="week" value={weekOffset} />}
          <label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Buscar por PRISM, título o dirección<input name="q" defaultValue={initialQuery} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <input type="hidden" name="tab" value={tab} />
          {initialStatus && <input type="hidden" name="status" value={initialStatus} />}
          <button className={buttonClasses({ variant: "secondary" })}>Buscar</button>
        </form>
        <form>
          {weekOffset !== undefined && <input type="hidden" name="week" value={weekOffset} />}
          {initialQuery && <input type="hidden" name="q" value={initialQuery} />}
          <input type="hidden" name="tab" value={tab} />
          <span className="text-sm font-medium text-ink-soft">Estado</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <FilterChip name="status" value="" label="Todos" active={!initialStatus} />
            {Object.entries({ ...statusLabels, ...manualFilterLabels }).map(([value, label]) => <FilterChip key={value} name="status" value={value} label={label} active={initialStatus === value} />)}
          </div>
        </form>
      </div>
      <WorkJobCards jobs={jobs} manualJobs={manualJobs} />
    </div>
  );
}
