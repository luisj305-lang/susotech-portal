import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconInbox } from "@/components/ui/icons";
import type { Job } from "@/lib/jobs/types";
import { getJobMapUrl } from "@/lib/jobs/maps";

const incidents: Record<string, string> = { need_splicing: "Requiere empalme", no_access: "Sin acceso", need_cr: "Requiere CR", permit_pending: "Permiso pendiente", returned: "Devuelto", incomplete: "Incompleto" };

const statusLabels: Record<string, string> = { asignado: "Asignado", en_revision: "En revisión", aprobado: "Aprobado", facturado: "Facturado", pagado: "Pagado" };

export function JobList({ jobs, initialQuery = "", initialStatus = "" }: { jobs: Job[]; initialQuery?: string; initialStatus?: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Dashboard</Link>
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Trabajo de campo</p>
        <h1 className="text-3xl font-bold text-ink">Mis trabajos</h1>
        <p className="mt-2 text-ink-soft">Órdenes activas asignadas directamente o por tu crew.</p>
      </header>
      <form className="grid gap-3 rounded-2xl border border-line bg-white p-4 shadow-card sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">Buscar por PRISM, título o dirección<input name="q" defaultValue={initialQuery} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
        <label className="grid gap-1 text-sm font-medium text-ink-soft">Estado<select name="status" defaultValue={initialStatus} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className={`${buttonClasses({ variant: "primary" })} sm:col-start-3`}>Aplicar filtros</button>
      </form>
      {jobs.length ? (
        <div className="grid gap-4">
          {jobs.map((job) => { const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url }); return <article key={job.id} className="rounded-2xl border border-line bg-white p-6 shadow-card"><div className="flex items-start justify-between gap-3"><h2 className="text-xl font-bold text-ink">{job.prism_number ? `PRISM ${job.prism_number}` : job.address || job.location || "Sin número PRISM"}</h2><StatusBadge status={job.main_status} /></div>{mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-4 block text-base text-accent-600 underline">{job.address || job.location}</a> : <p className="mt-4 text-base text-ink-soft">Ubicación no indicada</p>}{job.deadline_date && <p className="mt-2 text-sm font-medium text-ink-soft">Fecha límite: {new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(job.deadline_date))}</p>}{job.incident && <p className="mt-3 rounded-lg border border-line bg-surface-muted p-3 font-semibold text-ink">Incidencia: {incidents[job.incident]}</p>}<Link href={`/trabajos/${job.id}`} className={`${buttonClasses({ variant: "secondary" })} mt-4`}>Ver trabajo</Link></article>; })}
        </div>
      ) : (
        <EmptyState icon={IconInbox} title="No tienes trabajos asignados" description="Cuando recibas una asignación aparecerá aquí." />
      )}
    </div>
  );
}
