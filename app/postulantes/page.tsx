import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RecruitmentShell, RecruitmentStatus, recruitmentDate, recruitmentStatusLabels } from "@/components/recruitment/presentation";
import { requireOfficeViewer } from "@/lib/auth/session";
import { listRecruitmentApplications } from "@/lib/recruitment/queries";
import { isRecruitmentStatus } from "@/lib/recruitment/core";
import { RECRUITMENT_STATUSES } from "@/lib/recruitment/types";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pageHref(page: number, status: string) {
  const params = new URLSearchParams({ page: String(page) });
  if (status) params.set("status", status);
  return `/postulantes?${params}`;
}

export default async function RecruitmentPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireOfficeViewer();
  const params = await searchParams;
  const status = isRecruitmentStatus(params.status) ? params.status : "";
  const result = await listRecruitmentApplications({ status, page: Number(params.page) });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return <RecruitmentShell profile={profile}>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Administración</p><h1 className="mt-1 text-3xl font-bold text-ink">Postulantes</h1><p className="mt-2 text-ink-soft">Revise las solicitudes y dé seguimiento a su próximo equipo.</p></div>
      <a href="https://susotech.org/empleo" target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary" })}>Ver formulario público ↗</a>
    </header>
    <Link href="/postulantes/anteriores" className="inline-block text-sm font-medium text-accent-600 hover:underline">Ver solicitudes del formulario anterior →</Link>
    {params.error === "invalid" && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">No se pudo guardar: los datos enviados no son válidos. Abra la solicitud e intente nuevamente.</p>}
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-ink">Solicitudes recibidas <span className="ml-2 rounded-full bg-brand-50 px-2.5 py-1 text-sm text-brand-900">{result.total}</span></h2><p className="text-sm text-ink-muted">Acceso privado: administradores y supervisores</p></div>
      <nav aria-label="Filtrar postulantes por estado" className="flex flex-wrap gap-2">
        {["", ...RECRUITMENT_STATUSES].map((entry) => <Link key={entry} href={pageHref(1, entry)} aria-current={status === entry ? "page" : undefined} className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${status === entry ? "border-brand-900 bg-brand-900 text-white" : "border-line text-ink-soft hover:bg-surface-muted"}`}>{entry ? recruitmentStatusLabels[entry as keyof typeof recruitmentStatusLabels] : "Todos"}</Link>)}
      </nav>
    </Card>
    {result.applications.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {result.applications.map((application) => <Card key={application.id} className="flex flex-col p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-lg font-semibold text-ink">{application.full_name}</h2><p className="mt-1 text-sm text-ink-muted">{application.position}</p></div><RecruitmentStatus status={application.status} /></div>
        <dl className="my-5 grid gap-3 text-sm"><div><dt className="text-ink-muted">Ubicación</dt><dd className="font-medium">{application.city}, {application.state}</dd></div><div><dt className="text-ink-muted">Contacto</dt><dd className="break-all">{application.email}</dd><dd>{application.phone}</dd></div><div><dt className="text-ink-muted">Solicitud recibida</dt><dd>{recruitmentDate(application.submitted_at)}</dd></div></dl>
        <Link href={`/postulantes/${application.id}`} className={`${buttonClasses()} mt-auto w-full`} aria-label={`Ver solicitud de ${application.full_name}`}>Ver solicitud</Link>
      </Card>)}
    </div> : <Card className="p-10 text-center"><h2 className="text-lg font-semibold text-ink">No hay solicitudes{status ? " con este estado" : " todavía"}</h2><p className="mt-2 text-sm text-ink-muted">{status ? "Seleccione otro estado para continuar." : "Cuando alguien complete el formulario, su solicitud aparecerá aquí."}</p>{result.page > 1 && <Link href={pageHref(1, status)} className="mt-4 inline-block text-accent-600 hover:underline">Volver a la primera página</Link>}</Card>}
    {(totalPages > 1 || result.page > 1) && <nav aria-label="Paginación de postulantes" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-muted">Página {result.page} · {result.pageSize} solicitudes por página</p><div className="flex gap-2">{result.page > 1 && <Link href={pageHref(result.page - 1, status)} className={buttonClasses({ variant: "secondary" })}>Anterior</Link>}{result.page < totalPages && <Link href={pageHref(result.page + 1, status)} className={buttonClasses({ variant: "secondary" })}>Siguiente</Link>}</div></nav>}
    <p className="break-all text-sm text-ink-muted">Enlace para compartir: <a href="https://susotech.org/empleo" className="text-accent-600 hover:underline">https://susotech.org/empleo</a></p>
  </RecruitmentShell>;
}
