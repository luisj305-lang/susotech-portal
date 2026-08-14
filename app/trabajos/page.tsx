import Link from "next/link";
import { JobList } from "@/components/jobs/job-list";
import { ArchivedJobDeleteButton, RetryJobDeletionCleanupButton } from "@/components/jobs/archived-job-delete-button";
import { requireProfile } from "@/lib/auth/session";
import { listOfficeJobs, listTechnicianJobs } from "@/lib/jobs/queries";
import { deliveredPdfStatusClasses, jobStatusBadgeClasses } from "@/lib/jobs/status-presentation";
import { getJobMapUrl } from "@/lib/jobs/maps";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";

const statusLabels: Record<string, string> = { sin_asignar: "Sin asignar", asignado: "Asignado", en_progreso: "En progreso", enviado_revision: "En revisión", aprobado: "Aprobado", listo_pagar: "Listo para pagar", pagado: "Pagado" };
const deliveredLabels = { pending: "Pendiente", current: "Vigente", stale: "Desactualizado" } as const;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function relevantDate(job: { submitted_at: string | null; deadline_date: string | null; assignment_date: string | null; updated_at: string }) {
  const value = job.submitted_at || job.deadline_date || job.assignment_date || job.updated_at;
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(value));
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  if (profile.role === "tecnico") {
    await requireActiveShiftPage();
    return <JobList jobs={await listTechnicianJobs()} />;
  }
  const values = await searchParams;
  const first = (key: string) => { const value = values[key]; return Array.isArray(value) ? value[0] : value; };
  const filters = { q: first("q"), status: first("status"), category: first("category"), archived: first("archived") === "1" };
  const jobs = await listOfficeJobs({ query: filters.q, status: filters.status, category: filters.category, archived: filters.archived });

  return <main className="min-h-screen bg-black px-4 py-8 text-white sm:px-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard" className="text-sm font-medium text-white">← Dashboard</Link>
    <header className="my-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-widest text-white">Operaciones</p><h1 className="text-3xl font-bold">{filters.archived ? "Trabajos archivados" : "Trabajos"}</h1><p className="mt-1 text-white">Identifique cada orden, su asignación, documentos y evidencias sin abrirla.</p></div><div className="flex flex-wrap gap-3">{filters.archived && profile.role === "admin" && <RetryJobDeletionCleanupButton />}<Link href={filters.archived ? "/trabajos" : "/trabajos?archived=1"} className="rounded-lg border border-white px-5 py-3 font-semibold">{filters.archived ? "Ver activos" : "Ver archivados"}</Link><Link href="/trabajos/importar" className="rounded-lg bg-black px-5 py-3 font-bold text-white">Importar PDF</Link><Link href="/trabajos/nuevo" className="rounded-lg border border-white px-5 py-3 text-sm font-semibold text-white">Creación manual</Link></div></header>
    <form className="grid gap-3 rounded-2xl border border-white bg-black p-4 sm:grid-cols-4">{filters.archived && <input type="hidden" name="archived" value="1" />}<label className="grid gap-1 text-sm font-medium sm:col-span-2">Buscar por PRISM, título o dirección<input name="q" defaultValue={filters.q} className="rounded-lg border border-white bg-black p-3 text-white" /></label><label className="grid gap-1 text-sm font-medium">Estado<select name="status" defaultValue={filters.status} className="rounded-lg border border-white bg-black p-3"><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Categoría<select name="category" defaultValue={filters.category} className="rounded-lg border border-white bg-black p-3"><option value="">Todas</option><option value="categoria_1">Categoría 1</option><option value="categoria_2">Categoría 2</option><option value="categoria_3">Categoría 3</option></select></label><button className="rounded-lg border border-white px-4 py-2 font-semibold text-white sm:col-start-4">Aplicar filtros</button></form>
    {jobs.length ? <div className="mt-6 grid gap-4 sm:grid-cols-2">{jobs.map((job) => { const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url }); return <article key={job.id} className="rounded-2xl border border-white bg-black p-5 shadow-lg"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-white">{job.prism_number ? `PRISM ${job.prism_number}` : "Sin número PRISM"}</p>{mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xl font-bold underline">{job.address || job.location || job.title}</a> : <h2 className="mt-1 text-xl font-bold">{job.title}</h2>}<p className="mt-1 text-sm text-white">{job.title}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${jobStatusBadgeClasses[job.main_status]}`}>{statusLabels[job.main_status]}</span></div><dl className="mt-5 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-white">Categoría</dt><dd className="font-semibold">{job.category.replace("categoria_", "Categoría ")}</dd></div><div><dt className="text-white">Asignado</dt><dd className="font-semibold">{job.assignee_label}</dd></div><div><dt className="text-white">Fecha relevante</dt><dd className="font-semibold">{relevantDate(job)}</dd></div><div><dt className="text-white">Evidencias</dt><dd className="font-semibold">{job.photo_count} foto(s)</dd></div><div><dt className="text-white">PDF original</dt><dd className={job.project_pdf_url ? "font-semibold text-white" : "font-semibold text-white"}>{job.project_pdf_url ? "Disponible" : "No disponible"}</dd></div><div><dt className="text-white">PDF entregado</dt><dd className={`font-semibold ${deliveredPdfStatusClasses[job.delivered_pdf_status]}`}>{deliveredLabels[job.delivered_pdf_status]}</dd></div></dl>{job.incident && <p className="mt-4 rounded-lg border border-white bg-black p-3 text-sm font-semibold text-white">Incidencia: {job.incident}</p>}<Link href={`/trabajos/${job.id}`} className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-black px-5 font-bold text-white">Ver trabajo</Link>{filters.archived && profile.role === "admin" && <ArchivedJobDeleteButton jobId={job.id} label={job.prism_number ? `el trabajo PRISM ${job.prism_number}` : `el trabajo ${job.title}`} />}</article>; })}</div> : <section className="mt-6 rounded-2xl border border-dashed border-white p-10 text-center"><h2 className="font-semibold">No hay trabajos que coincidan</h2><p className="mt-2 text-sm text-white">Cambie los filtros o importe un PDF.</p></section>}
  </div></main>;
}
