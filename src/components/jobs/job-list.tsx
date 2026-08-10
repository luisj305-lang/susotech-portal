import Link from "next/link";
import type { Job } from "@/lib/jobs/types";

const statuses: Record<string, string> = { asignado: "Asignado", en_progreso: "En progreso", enviado_revision: "En revisión", aprobado: "Aprobado", listo_pagar: "Listo para pagar", pagado: "Pagado" };
const incidents: Record<string, string> = { need_splicing: "Requiere empalme", no_access: "Sin acceso", need_cr: "Requiere CR", permit_pending: "Permiso pendiente", returned: "Devuelto", incomplete: "Incompleto" };

export function JobList({ jobs }: { jobs: Job[] }) {
  return <main className="min-h-screen bg-black px-4 py-6 text-white"><div className="mx-auto max-w-xl"><Link href="/dashboard" className="text-sm font-medium text-white">← Dashboard</Link><header className="my-6"><p className="text-sm font-semibold uppercase tracking-widest text-white">Trabajo de campo</p><h1 className="text-3xl font-bold">Mis trabajos</h1><p className="mt-2 text-white">Órdenes activas asignadas directamente o por tu crew.</p></header>
    {jobs.length ? <div className="grid gap-4">{jobs.map((job) => <Link key={job.id} href={`/trabajos/${job.id}`} className="min-h-40 rounded-2xl bg-black p-5 text-white shadow-lg focus-visible:outline-4 focus-visible:outline-white"><div className="flex items-start justify-between gap-3"><h2 className="text-xl font-bold">{job.title}</h2><span className="rounded-full bg-black px-3 py-1 text-xs font-bold text-white">{statuses[job.main_status]}</span></div><p className="mt-4 text-base text-white">{job.address || job.location || "Ubicación no indicada"}</p>{job.deadline_date && <p className="mt-2 text-sm font-medium">Fecha límite: {new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(job.deadline_date))}</p>}{job.incident && <p className="mt-3 rounded-lg bg-black p-3 font-semibold text-white">Incidencia: {incidents[job.incident]}</p>}</Link>)}</div> : <section className="rounded-2xl border border-dashed border-white p-10 text-center"><h2 className="text-xl font-semibold">No tienes trabajos asignados</h2><p className="mt-2 text-white">Cuando recibas una asignación aparecerá aquí.</p></section>}
  </div></main>;
}
