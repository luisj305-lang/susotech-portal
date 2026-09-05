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

const incidents: Record<string, string> = { need_splicing: "Requiere empalme", no_access: "Sin acceso", need_cr: "Requiere CR", permit_pending: "Permiso pendiente", returned: "Devuelto", incomplete: "Incompleto" };

const statusLabels: Record<string, string> = { asignado: "Asignado", en_revision: "En revisión", aprobado: "Aprobado" };

function technicianStatus(status: Job["main_status"]): Job["main_status"] {
  return status === "facturado" || status === "pagado" ? "aprobado" : status;
}

function tabHref(tab: string, query?: string, status?: string) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (query) params.set("q", query);
  if (status) params.set("status", status);
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

export function JobList({ jobs, initialQuery = "", initialStatus = "", tab = "activos" }: { jobs: Job[]; initialQuery?: string; initialStatus?: string; tab?: string }) {
  const groups = groupJobParts(jobs);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Dashboard</Link>
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Trabajo de campo</p>
        <h1 className="text-3xl font-bold text-ink">Mis trabajos</h1>
        <p className="mt-2 text-ink-soft">Órdenes activas asignadas directamente o por tu crew.</p>
      </header>
      <nav aria-label="Vistas de trabajo" className="flex gap-2">
        <Link href={tabHref("activos", initialQuery, initialStatus)} aria-current={tab === "activos" ? "page" : undefined} className={buttonClasses({ variant: tab === "activos" ? "primary" : "secondary", size: "sm" })}>Activos</Link>
        <Link href={tabHref("revisados", initialQuery, initialStatus)} aria-current={tab === "revisados" ? "page" : undefined} className={buttonClasses({ variant: tab === "revisados" ? "primary" : "secondary", size: "sm" })}>Revisados</Link>
      </nav>
      <div className="grid gap-4 rounded-2xl border border-line bg-white p-4 shadow-card">
        <form className="flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Buscar por PRISM, título o dirección<input name="q" defaultValue={initialQuery} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <input type="hidden" name="tab" value={tab} />
          {initialStatus && <input type="hidden" name="status" value={initialStatus} />}
          <button className={buttonClasses({ variant: "secondary" })}>Buscar</button>
        </form>
        <form>
          {initialQuery && <input type="hidden" name="q" value={initialQuery} />}
          <input type="hidden" name="tab" value={tab} />
          <span className="text-sm font-medium text-ink-soft">Estado</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <FilterChip name="status" value="" label="Todos" active={!initialStatus} />
            {Object.entries(statusLabels).map(([value, label]) => <FilterChip key={value} name="status" value={value} label={label} active={initialStatus === value} />)}
          </div>
        </form>
      </div>
      {groups.length ? (
        <div className="grid gap-4">
          {groups.map((group) => (
            <div key={group.root.id} className="grid gap-4">
              <JobCard job={group.root} />
              {group.children.length > 0 && (
                <div className="grid gap-4 border-l-2 border-line pl-4">
                  {group.children.map((child) => <JobCard key={child.id} job={child} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={IconInbox} title="No tienes trabajos asignados" description="Cuando recibas una asignación aparecerá aquí." />
      )}
    </div>
  );
}
