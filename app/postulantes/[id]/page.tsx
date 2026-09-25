import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/ui/button";
import { RecruitmentShell, RecruitmentStatus, RecruitmentSection, RecruitmentField, recruitmentDate, recruitmentFieldClass, recruitmentStatusLabels } from "@/components/recruitment/presentation";
import { RecruitmentSubmitButton } from "@/components/recruitment/submit-button";
import { requireOfficeViewer } from "@/lib/auth/session";
import { getRecruitmentApplication } from "@/lib/recruitment/queries";
import { updateRecruitmentApplication } from "@/lib/recruitment/actions";
import { RECRUITMENT_STATUSES } from "@/lib/recruitment/types";

export default async function RecruitmentDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireOfficeViewer();
  const { id } = await params;
  const query = await searchParams;
  const application = await getRecruitmentApplication(id);
  if (!application) notFound();
  const errors: Record<string, string> = {
    save: "No se pudo guardar el seguimiento. Intente nuevamente.",
    conflict: "Otra persona actualizó esta solicitud. Se cargó la versión más reciente; revise los cambios antes de guardar nuevamente.",
  };
  const error = typeof query.error === "string" ? errors[query.error] : undefined;

  return <RecruitmentShell profile={profile}>
    <Link href="/postulantes" className="text-sm font-medium text-accent-600 hover:underline">← Volver a postulantes</Link>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="break-words text-3xl font-bold text-ink">{application.full_name}</h1><p className="mt-2 text-ink-soft">{application.position} · Solicitud del {recruitmentDate(application.submitted_at)}</p></div><RecruitmentStatus status={application.status} /></header>
    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
    {query.saved === "1" && !error && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">Seguimiento guardado correctamente.</p>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <div className="min-w-0 space-y-6">
        <RecruitmentSection title="Información personal"><dl className="grid gap-5 sm:grid-cols-2">
          <RecruitmentField label="Nombre completo" value={application.full_name} />
          <RecruitmentField label="Teléfono" value={application.phone} />
          <RecruitmentField label="Correo electrónico" value={application.email} />
          <RecruitmentField label="Ciudad" value={application.city} />
          <RecruitmentField label="Estado" value={application.state} />
          <RecruitmentField label="Código postal" value={application.postal_code} />
        </dl></RecruitmentSection>
        <RecruitmentSection title="Puesto y disponibilidad"><dl className="grid gap-5 sm:grid-cols-2">
          <RecruitmentField label="Puesto solicitado" value={application.position} />
          <RecruitmentField label="Fecha disponible para comenzar" value={recruitmentDate(application.start_date)} />
          <RecruitmentField label="Disponibilidad para fines de semana" value={application.available_weekends ? "Sí" : "No"} />
          <RecruitmentField label="Disponibilidad para viajar" value={application.can_travel ? "Sí" : "No"} />
          <RecruitmentField label="Licencia de conducir vigente" value={application.has_license ? "Sí" : "No"} />
          {application.has_license && <RecruitmentField label="Tipo de licencia" value={application.license_type} />}
        </dl></RecruitmentSection>
        <RecruitmentSection title="Experiencia y formación"><dl className="grid gap-5">
          <RecruitmentField label="Experiencia laboral" value={application.experience_details} />
          <RecruitmentField label="Certificaciones y cursos" value={application.certifications} />
          <RecruitmentField label="Comentarios adicionales" value={application.additional_comments} />
        </dl></RecruitmentSection>
        <RecruitmentSection title="Hoja de vida">{application.resume_path ? <><p className="mb-3 break-words text-sm text-ink-muted">{application.resume_name ?? "Documento PDF"}</p><a href={`/postulantes/${application.id}/cv`} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary" })}>Descargar hoja de vida</a><p className="mt-3 text-xs text-ink-muted">Documento privado. No comparta el enlace de descarga.</p></> : <p className="text-sm text-ink-muted">El postulante no adjuntó una hoja de vida.</p>}</RecruitmentSection>
      </div>
      <RecruitmentSection title="Seguimiento interno">
        <p className="mb-5 text-sm text-ink-muted">Solo administradores y supervisores pueden ver y editar esta información.</p>
        <form action={updateRecruitmentApplication} className="space-y-4">
          <input type="hidden" name="id" value={application.id} />
          <input type="hidden" name="updated_at" value={application.updated_at} />
          <label className="grid gap-2 text-sm font-medium text-ink">Estado<select name="status" defaultValue={application.status} className={recruitmentFieldClass}>{RECRUITMENT_STATUSES.map((status) => <option key={status} value={status}>{recruitmentStatusLabels[status]}</option>)}</select></label>
          <label className="grid gap-2 text-sm font-medium text-ink">Notas privadas<textarea name="internal_notes" rows={8} maxLength={10000} defaultValue={application.internal_notes} placeholder="Contacto realizado, próximos pasos o comentarios de la entrevista..." className={recruitmentFieldClass} /></label>
          <RecruitmentSubmitButton />
        </form>
      </RecruitmentSection>
    </div>
  </RecruitmentShell>;
}
