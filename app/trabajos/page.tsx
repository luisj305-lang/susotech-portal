import Link from "next/link";
import { JobList } from "@/components/jobs/job-list";
import { requireProfile } from "@/lib/auth/session";
import { listOfficeJobs, listTechnicianJobs } from "@/lib/jobs/queries";

const statusLabels: Record<string, string> = { asignado: "Asignado", en_progreso: "En progreso", enviado_revision: "En revisión", aprobado: "Aprobado", listo_pagar: "Listo para pagar", pagado: "Pagado" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  if (profile.role === "tecnico") return <JobList jobs={await listTechnicianJobs()} />;
  const values = await searchParams;
  const first = (key: string) => { const value = values[key]; return Array.isArray(value) ? value[0] : value; };
  const filters = { q: first("q"), status: first("status"), category: first("category") };
  const jobs = await listOfficeJobs({ query: filters.q, status: filters.status, category: filters.category });
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard" className="text-sm font-medium">← Dashboard</Link>
    <header className="my-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">Operaciones</p><h1 className="text-3xl font-bold">Trabajos</h1><p className="mt-1 text-slate-600">Busca, filtra y abre cada orden de trabajo.</p></div><div className="flex flex-wrap gap-3"><Link href="/equipos" className="rounded-lg border px-5 py-3 font-semibold">Equipos</Link><Link href="/trabajos/importar" className="rounded-lg border px-5 py-3 font-semibold">Importar trabajos</Link><Link href="/trabajos/nuevo" className="rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white">+ Nuevo trabajo</Link></div></header>
    <form className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-4"><label className="grid gap-1 text-sm font-medium sm:col-span-2">Buscar por título<input name="q" defaultValue={filters.q} className="rounded-lg border p-3" /></label><label className="grid gap-1 text-sm font-medium">Estado<select name="status" defaultValue={filters.status} className="rounded-lg border p-3"><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Categoría<select name="category" defaultValue={filters.category} className="rounded-lg border p-3"><option value="">Todas</option><option value="categoria_1">Categoría 1</option><option value="categoria_2">Categoría 2</option><option value="categoria_3">Categoría 3</option></select></label><button className="rounded-lg border px-4 py-2 font-semibold sm:col-start-4">Aplicar filtros</button></form>
    {jobs.length ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{jobs.map((job) => <Link key={job.id} href={`/trabajos/${job.id}`} className="rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{job.title}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{statusLabels[job.main_status]}</span></div><p className="mt-3 text-sm text-slate-600">{job.address || job.location || "Sin ubicación"}</p><p className="mt-4 text-xs font-semibold uppercase tracking-wide text-emerald-700">{job.category.replace("_", " ")}</p>{job.incident && <p className="mt-2 text-sm font-medium text-amber-700">Incidencia: {job.incident}</p>}</Link>)}</div> : <section className="mt-6 rounded-2xl border border-dashed bg-white p-10 text-center"><h2 className="font-semibold">No hay trabajos que coincidan</h2><p className="mt-2 text-sm text-slate-600">Cambia los filtros o crea un trabajo nuevo.</p></section>}
  </div></main>;
}
