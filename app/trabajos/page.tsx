import Link from "next/link";
import { JobList } from "@/components/jobs/job-list";
import { requireProfile } from "@/lib/auth/session";
import { listOfficeJobs, listTechnicianJobs } from "@/lib/jobs/queries";

const statusLabels: Record<string, string> = { asignado: "Asignado", en_progreso: "En progreso", enviado_revision: "En revisión", aprobado: "Aprobado", listo_pagar: "Listo para pagar", pagado: "Pagado" };
const deliveredLabels = { pending: "Pendiente", current: "Vigente", stale: "Desactualizado" } as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function relevantDate(job: { submitted_at: string | null; deadline_date: string | null; assignment_date: string | null; updated_at: string }) {
  const value = job.submitted_at || job.deadline_date || job.assignment_date || job.updated_at;
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(value));
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  if (profile.role === "tecnico") return <JobList jobs={await listTechnicianJobs()} />;
  const values = await searchParams;
  const first = (key: string) => { const value = values[key]; return Array.isArray(value) ? value[0] : value; };
  const filters = { q: first("q"), status: first("status"), category: first("category") };
  const jobs = await listOfficeJobs({ query: filters.q, status: filters.status, category: filters.category });
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard" className="text-sm font-medium">← Dashboard</Link>
    <header className="my-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">Operaciones</p><h1 className="text-3xl font-bold">Trabajos</h1><p className="mt-1 text-slate-600">Identifique cada orden, su asignación, documentos y evidencias sin abrirla.</p></div><div className="flex flex-wrap gap-3"><Link href="/equipos" className="rounded-lg border px-5 py-3 font-semibold">Equipos</Link><Link href="/trabajos/importar" className="rounded-lg bg-slate-900 px-5 py-3 font-bold text-white">Importar PDF</Link><Link href="/trabajos/nuevo" className="rounded-lg border px-5 py-3 text-sm font-semibold">Creación manual</Link></div></header>
    <form className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-4"><label className="grid gap-1 text-sm font-medium sm:col-span-2">Buscar por PRISM, título o dirección<input name="q" defaultValue={filters.q} className="rounded-lg border p-3" /></label><label className="grid gap-1 text-sm font-medium">Estado<select name="status" defaultValue={filters.status} className="rounded-lg border p-3"><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Categoría<select name="category" defaultValue={filters.category} className="rounded-lg border p-3"><option value="">Todas</option><option value="categoria_1">Categoría 1</option><option value="categoria_2">Categoría 2</option><option value="categoria_3">Categoría 3</option></select></label><button className="rounded-lg border px-4 py-2 font-semibold sm:col-start-4">Aplicar filtros</button></form>
    {jobs.length ? <div className="mt-6 grid gap-4 sm:grid-cols-2">{jobs.map((job) => <article key={job.id} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{job.prism_number ? `PRISM ${job.prism_number}` : "Sin número PRISM"}</p><h2 className="mt-1 text-xl font-bold">{job.address || job.location || job.title}</h2><p className="mt-1 text-sm text-slate-600">{job.title}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{statusLabels[job.main_status]}</span></div><dl className="mt-5 grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-600">Categoría</dt><dd className="font-semibold">{job.category.replace("categoria_", "Categoría ")}</dd></div><div><dt className="text-slate-600">Asignado</dt><dd className="font-semibold">{job.assignee_label}</dd></div><div><dt className="text-slate-600">Fecha relevante</dt><dd className="font-semibold">{relevantDate(job)}</dd></div><div><dt className="text-slate-600">Evidencias</dt><dd className="font-semibold">{job.photo_count} foto(s)</dd></div><div><dt className="text-slate-600">PDF original</dt><dd className={job.project_pdf_url ? "font-semibold text-emerald-700" : "font-semibold text-slate-600"}>{job.project_pdf_url ? "Disponible" : "No disponible"}</dd></div><div><dt className="text-slate-600">PDF entregado</dt><dd className={`font-semibold ${job.delivered_pdf_status === "current" ? "text-emerald-700" : job.delivered_pdf_status === "stale" ? "text-amber-700" : "text-slate-600"}`}>{deliveredLabels[job.delivered_pdf_status]}</dd></div></dl>{job.incident && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">Incidencia: {job.incident}</p>}<Link href={`/trabajos/${job.id}`} className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-5 font-bold text-white">Ver trabajo</Link></article>)}</div> : <section className="mt-6 rounded-2xl border border-dashed bg-white p-10 text-center"><h2 className="font-semibold">No hay trabajos que coincidan</h2><p className="mt-2 text-sm text-slate-600">Cambie los filtros o importe un PDF.</p></section>}
  </div></main>;
}
