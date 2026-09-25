import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RecruitmentShell, RecruitmentField, recruitmentDate } from "@/components/recruitment/presentation";
import { requireOfficeViewer } from "@/lib/auth/session";
import { listLegacyRecruitmentApplications } from "@/lib/recruitment/queries";

export default async function LegacyRecruitmentPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireOfficeViewer();
  const params = await searchParams;
  const result = await listLegacyRecruitmentApplications({ page: Number(params.page) });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return <RecruitmentShell profile={profile}>
    <Link href="/postulantes" className="text-sm font-medium text-accent-600 hover:underline">← Volver a postulantes</Link>
    <header>
      <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Archivo de contratación</p>
      <h1 className="mt-1 text-3xl font-bold text-ink">Solicitudes anteriores</h1>
      <p className="mt-2 text-ink-soft">Solicitudes recibidas mediante el formulario corto original. Se muestran tal como fueron registradas, solo para consulta.</p>
    </header>
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <h2 className="text-lg font-semibold text-ink">{result.total} solicitudes anteriores</h2>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Solo lectura</span>
      <p className="w-full text-sm text-ink-muted">Estos registros no incluyen los campos ni el seguimiento del formulario nuevo. Acceso exclusivo para administradores y supervisores.</p>
    </Card>
    {result.applications.length ? <div className="grid items-start gap-4 lg:grid-cols-2">
      {result.applications.map((application) => <Card key={application.id} className="min-w-0 p-5 sm:p-6">
        <h2 className="break-words text-xl font-semibold text-ink">{application.full_name}</h2>
        <p className="mt-1 text-sm text-ink-muted">Recibida el {recruitmentDate(application.created_at)}</p>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          <RecruitmentField label="Correo electrónico" value={application.email} />
          <RecruitmentField label="Teléfono" value={application.phone} />
          <RecruitmentField label="Puesto solicitado" value={application.position} />
          <RecruitmentField label="Experiencia" value={application.experience} />
          <div className="sm:col-span-2"><RecruitmentField label="Mensaje" value={application.message} /></div>
        </dl>
      </Card>)}
    </div> : <Card className="p-10 text-center">
      <h2 className="text-lg font-semibold text-ink">No hay solicitudes anteriores en esta página</h2>
      <p className="mt-2 text-sm text-ink-muted">Aquí se muestran únicamente los registros del formulario original.</p>
      {result.page > 1 && <Link href="/postulantes/anteriores" className="mt-4 inline-block text-accent-600 hover:underline">Volver a la primera página</Link>}
    </Card>}
    {(totalPages > 1 || result.page > 1) && <nav aria-label="Paginación de solicitudes anteriores" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-muted">Página {result.page} · {result.pageSize} solicitudes por página</p>
      <div className="flex gap-2">
        {result.page > 1 && <Link href={`/postulantes/anteriores?page=${result.page - 1}`} className={buttonClasses({ variant: "secondary" })}>Anterior</Link>}
        {result.page < totalPages && <Link href={`/postulantes/anteriores?page=${result.page + 1}`} className={buttonClasses({ variant: "secondary" })}>Siguiente</Link>}
      </div>
    </nav>}
  </RecruitmentShell>;
}
