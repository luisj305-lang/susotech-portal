import Link from "next/link";
import { JobList } from "@/components/jobs/job-list";
import { ArchivedJobDeleteButton, RetryJobDeletionCleanupButton } from "@/components/jobs/archived-job-delete-button";
import { AppShell } from "@/components/dashboard/app-shell";
import { FieldShell } from "@/components/dashboard/field-shell";
import { buttonClasses } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireProfile } from "@/lib/auth/session";
import { listOfficeJobs, listTechnicianJobs } from "@/lib/jobs/queries";
import { getJobMapUrl } from "@/lib/jobs/maps";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";

const statusLabels: Record<string, string> = { sin_asignar: "Sin asignar", asignado: "Asignado", en_revision: "En revisión", aprobado: "Aprobado", facturado: "Facturado", pagado: "Pagado" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function relevantDate(job: { submitted_at: string | null; deadline_date: string | null; assignment_date: string | null; updated_at: string }) {
  const value = job.submitted_at || job.deadline_date || job.assignment_date || job.updated_at;
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(value));
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  const values = await searchParams;
  const first = (key: string) => { const value = values[key]; return Array.isArray(value) ? value[0] : value; };
  if (profile.role === "tecnico") {
    await requireActiveShiftPage();
    const query = first("q");
    const status = first("status");
    const jobs = await listTechnicianJobs({ query, status });
    return <FieldShell userName={displayName(profile)}><JobList jobs={jobs} initialQuery={query ?? ""} initialStatus={status ?? ""} /></FieldShell>;
  }
  const filters = { q: first("q"), status: first("status"), category: first("category"), archived: first("archived") === "1", facturados: first("facturados") === "1" };
  const jobs = await listOfficeJobs({ query: filters.q, status: filters.status, category: filters.category, archived: filters.archived, facturados: filters.facturados });

  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Dashboard</Link>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Operaciones</p>
            <h1 className="text-3xl font-bold text-ink">{filters.archived ? "Trabajos archivados" : filters.facturados ? "Trabajos facturados" : "Trabajos"}</h1>
            <p className="mt-1 text-ink-soft">Identifique cada orden, su asignación, documentos y evidencias sin abrirla.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {filters.archived && profile.role === "admin" && <RetryJobDeletionCleanupButton />}
            {!filters.archived && !filters.facturados && <Link href="/trabajos?facturados=1" className={buttonClasses({ variant: "secondary" })}>Ver facturados</Link>}
            {filters.archived || filters.facturados ? <Link href="/trabajos" className={buttonClasses({ variant: "secondary" })}>Ver activos</Link> : <Link href="/trabajos?archived=1" className={buttonClasses({ variant: "secondary" })}>Ver archivados</Link>}
            <Link href="/trabajos/importar" className={buttonClasses({ variant: "primary" })}>Importar PDF</Link>
            <Link href="/trabajos/nuevo" className={buttonClasses({ variant: "secondary" })}>Creación manual</Link>
          </div>
        </header>
        <form className="grid gap-3 rounded-2xl border border-line bg-white p-4 shadow-card sm:grid-cols-4">
          {filters.archived && <input type="hidden" name="archived" value="1" />}
          {filters.facturados && <input type="hidden" name="facturados" value="1" />}
          <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">Buscar por PRISM, título o dirección<input name="q" defaultValue={filters.q} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Estado<select name="status" defaultValue={filters.status} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">Categoría<select name="category" defaultValue={filters.category} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="">Todas</option><option value="categoria_1">Categoría 1</option><option value="categoria_2">Categoría 2</option><option value="categoria_3">Categoría 3</option></select></label>
          <button className={`${buttonClasses({ variant: "primary" })} sm:col-start-4`}>Aplicar filtros</button>
        </form>
        {jobs.length ? <div className="grid gap-4 sm:grid-cols-2">{jobs.map((job) => { const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url }); return <article key={job.id} className="rounded-2xl border border-line bg-white p-6 shadow-card"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-ink-muted">{job.prism_number ? `PRISM ${job.prism_number}` : "Sin número PRISM"}</p>{mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xl font-bold text-ink underline">{job.address || job.location || "Sin dirección"}</a> : <h2 className="mt-1 text-xl font-bold text-ink">{job.address || job.location || "Sin dirección"}</h2>}<p className="mt-1 text-sm text-ink-soft">{job.job_type ?? ""}</p></div><StatusBadge status={job.main_status} /></div><dl className="mt-5 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-ink-muted">Categoría</dt><dd className="font-semibold">{job.category.replace("categoria_", "Categoría ")}</dd></div><div><dt className="text-ink-muted">Asignado</dt><dd className="font-semibold">{job.assignee_label}</dd></div><div><dt className="text-ink-muted">Fecha relevante</dt><dd className="font-semibold">{relevantDate(job)}</dd></div><div><dt className="text-ink-muted">Evidencias</dt><dd className="font-semibold">{job.photo_count} foto(s)</dd></div><div><dt className="text-ink-muted">PDF original</dt><dd className="font-semibold">{job.project_pdf_url ? "Disponible" : "No disponible"}</dd></div><div><dt className="text-ink-muted">PDF entregado</dt><dd><StatusBadge status={`pdf_${job.delivered_pdf_status}`} /></dd></div></dl>{job.incident && <p className="mt-4 rounded-lg border border-line bg-surface-muted p-3 text-sm font-semibold text-ink">Incidencia: {job.incident}</p>}<Link href={`/trabajos/${job.id}`} className={`${buttonClasses({ variant: "primary" })} mt-5`}>Ver trabajo</Link>{filters.archived && (profile.role === "admin" || profile.role === "supervisor") && <ArchivedJobDeleteButton jobId={job.id} label={job.prism_number ? `el trabajo PRISM ${job.prism_number}` : `el trabajo ${job.title}`} />}</article>; })}</div> : <section className="rounded-2xl border border-dashed border-line p-10 text-center"><h2 className="font-semibold text-ink">No hay trabajos que coincidan</h2><p className="mt-2 text-sm text-ink-muted">Cambie los filtros o importe un PDF.</p></section>}
      </div>
    </AppShell>
  );
}
