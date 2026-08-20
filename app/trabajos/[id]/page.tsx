import Link from "next/link";
import { notFound } from "next/navigation";
import { JobForm } from "@/components/jobs/job-form";
import { JobDocuments } from "@/components/jobs/job-documents";
import { JobAttachments } from "@/components/jobs/job-attachments";
import { ArchiveHistory } from "@/components/jobs/archive-history";
import { JobEvidenceList } from "@/components/jobs/job-evidence-list";
import { OfficeJobActions } from "@/components/jobs/office-job-actions";
import { PhotoUpload } from "@/components/jobs/photo-upload";
import { TechnicianActions } from "@/components/jobs/technician-actions";
import { Timeline } from "@/components/jobs/timeline";
import { AppShell } from "@/components/dashboard/app-shell";
import { TechnicianAppShell } from "@/components/dashboard/technician-app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCamera } from "@/components/ui/icons";
import { JobHeader } from "@/components/technician/job-header";
import { ShiftStatusCard } from "@/components/technician/shift-status-card";
import { JobProgress } from "@/components/technician/job-progress";
import { IncidentCard } from "@/components/technician/incident-card";
import { CollapsibleTimeline } from "@/components/technician/collapsible-timeline";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireProfile } from "@/lib/auth/session";
import { isOperationalFieldWorker } from "@/lib/auth/capabilities";
import { getOfficeJob, getTechnicianJob } from "@/lib/jobs/queries";
import { isOfficeRole } from "@/lib/jobs/state";
import { getJobMapUrl } from "@/lib/jobs/maps";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";

import { getDeliveredPdfStatus } from "@/lib/jobs/delivered-status";


async function TechnicianDetail({ id, canMutate, userName, shiftAccess }: { id: string; canMutate: boolean; userName: string; shiftAccess: Awaited<ReturnType<typeof requireActiveShiftPage>> }) {
  const detail = await getTechnicianJob(id);
  if (!detail) notFound();
  const { job, history, codes, photos, documents, draft, deliveredDraftVersion, allocations } = detail;
  const currentAllocations = allocations.filter((allocation) => allocation.is_current);
  const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url });
  const additionalDocs = documents.filter((document) => document.document_type === "additional");
  return (
    <TechnicianAppShell userName={userName}>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <JobHeader job={job} mapUrl={mapUrl} />
          <div className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-20 lg:self-start">
            <ShiftStatusCard shift={shiftAccess.shift} active={shiftAccess.active} />
          </div>
          <section className="grid gap-6 md:grid-cols-2">
            <JobProgress status={job.main_status} lastUpdated={job.updated_at} />
            <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
              <h2 className="text-xl font-bold text-ink">Instrucciones</h2>
              <dl className="mt-3 grid gap-3">
                <div><dt className="font-semibold text-ink-soft">Descripción</dt><dd className="text-ink">{job.description || "Sin descripción"}</dd></div>
                <div><dt className="font-semibold text-ink-soft">Instrucciones especiales</dt><dd className="text-ink">{job.special_instructions || "Ninguna"}</dd></div>
                <div><dt className="font-semibold text-ink-soft">Material requerido</dt><dd className="text-ink">{job.required_material || "No indicado"}</dd></div>
              </dl>
              {mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-12 items-center font-bold text-accent-600 underline">Abrir mapa del proyecto</a>}
            </section>
          </section>
          {canMutate && <TechnicianActions jobId={job.id} status={job.main_status} />}
          {currentAllocations.length > 0 && <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-xl font-bold text-ink">Tu reparto financiero</h2>{currentAllocations.map((allocation) => <p key={allocation.allocation_version_id} className="mt-3 rounded-lg border border-line bg-surface-muted p-3 text-ink"><strong>{((Number(allocation.percentage_basis_points)) / 100).toFixed(2)}%</strong> · ${(Number(allocation.allocated_cents) / 100).toFixed(2)} <span className="text-ink-soft">(pendiente)</span></p>)}<p className="mt-3 text-xs text-ink-soft">Monto visible desde la confirmación de la entrega. Se confirma al aprobar o facturar el trabajo.</p></section>}
          <JobDocuments jobId={job.id} originalPath={job.project_pdf_url} deliveredPath={job.delivered_pdf_path} deliveredStatus={getDeliveredPdfStatus(job, photos.map((photo) => photo.id), documents.map((document) => document.id), draft?.version, deliveredDraftVersion)} jobStatus={job.main_status} attachments={<JobAttachments jobId={job.id} documents={additionalDocs} canManage={false} bare />} />
          {canMutate && ["asignado", "en_revision"].includes(job.main_status) && <PhotoUpload jobId={job.id} />}
          <section id="evidencias" className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-xl font-bold text-ink">Evidencia guardada ({photos.length})</h2>{photos.length > 0 ? <JobEvidenceList photos={photos} canDelete={false} /> : <EmptyState icon={IconCamera} title="Todavía no hay fotografías" description="Agrega evidencia antes de entregar el trabajo." />}{job.comments && <p className="mt-3 rounded-lg border border-line bg-surface-muted p-3 text-ink"><strong>Comentario general:</strong> {job.comments}</p>}</section>
          {canMutate && <div className="lg:col-start-2 lg:row-start-2 lg:self-start"><IncidentCard jobId={job.id} incident={job.incident} /></div>}
          {codes.length > 0 && <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-xl font-bold text-ink">Producción histórica</h2><p className="text-sm text-ink-soft">Los nuevos códigos y cantidades se registran dentro del editor de entrega.</p><ul className="mt-3 grid gap-2">{codes.map((code) => <li key={code.id} className="rounded-lg border border-line p-3 text-ink"><strong>{code.code}</strong> · {code.quantity}{code.notes ? ` · ${code.notes}` : ""}</li>)}</ul></section>}
          <CollapsibleTimeline entries={history} />
        </div>
      </div>
    </TechnicianAppShell>
  );
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  if (profile.role === "tecnico") {
    const shiftAccess = await requireActiveShiftPage();
    return <TechnicianDetail id={id} canMutate={isOperationalFieldWorker(profile)} userName={displayName(profile)} shiftAccess={shiftAccess} />;
  }
  const detail = await getOfficeJob(id);
  if (!detail) notFound();
  const { job, assignment, history, archiveEvents, options, photos, codes, documents, draft, deliveredDraftVersion, allocations } = detail;
  const currentAllocations = allocations.filter((allocation) => allocation.is_current);
  const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url });
  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/trabajos" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Trabajos</Link>
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">{job.category.replace("_", " ")}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-ink">{job.prism_number || job.address || "Sin número PRISM"}</h1>
            <StatusBadge status={job.main_status} />
          </div>
          {mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-accent-600 underline">{job.address || job.location}</a>}
          <p className="mt-1 text-ink-soft">Estado: {job.main_status.replaceAll("_", " ")}{job.incident ? ` · Incidencia: ${job.incident}` : ""}{job.invoice_number ? ` · Factura: ${job.invoice_number}` : ""}</p>
          {job.archived_at && <div className="mt-2 rounded-xl border border-line bg-surface-muted p-3 font-semibold text-ink"><p>Archivado: {job.archive_reason || "Sin motivo"}</p>{job.archive_notes && <p className="mt-1 font-normal">{job.archive_notes}</p>}</div>}
        </header>
        <JobDocuments jobId={job.id} originalPath={job.project_pdf_url} deliveredPath={job.delivered_pdf_path} deliveredStatus={getDeliveredPdfStatus(job, photos.map((photo) => photo.id), documents.map((document) => document.id), draft?.version, deliveredDraftVersion)} jobStatus={job.main_status} canRegenerate={profile.role === "admin"} canDelete={profile.role === "admin"} />
        <JobAttachments jobId={job.id} documents={documents.filter((document) => document.document_type === "additional")} canManage={isOfficeRole(profile.role)} />
        <OfficeJobActions jobId={job.id} status={job.main_status} assignment={assignment} options={options} canArchive={isOfficeRole(profile.role)} archived={Boolean(job.archived_at)} invoiceNumber={job.invoice_number} invoicePath={job.invoice_path} />
        {currentAllocations.length > 0 && <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="mb-3 text-lg font-semibold text-ink">Reparto financiero</h2><div className="grid gap-2">{currentAllocations.map((allocation) => <div key={`${allocation.allocation_version_id}-${allocation.participant_id}`} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted p-3 text-ink"><div><strong>{allocation.participant_name}</strong><span className="text-ink-soft"> · {allocation.worker_specialty}</span></div><div className="text-right"><strong>{((Number(allocation.percentage_basis_points)) / 100).toFixed(2)}%</strong> · ${(Number(allocation.allocated_cents) / 100).toFixed(2)}</div></div>)}</div><p className="mt-3 text-xs text-ink-soft">Distribución registrada al confirmar la entrega. Se confirma al aprobar o facturar el trabajo.</p></section>}
        <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="mb-3 text-lg font-semibold text-ink">Datos del trabajo</h2><div className="text-ink"><JobForm job={job} /></div></section>
        {codes.length > 0 && <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-lg font-semibold text-ink">Producción histórica</h2><ul className="mt-3 grid gap-2">{codes.map((code) => <li key={code.id} className="rounded-lg border border-line p-3 text-ink"><strong>{code.code}</strong> · {code.quantity} {code.unit_snapshot === "foot" ? "ft" : code.unit_snapshot === "hour" ? "hr" : ""}{code.amount_snapshot !== null ? ` · $${Number(code.amount_snapshot).toFixed(2)}` : ""}</li>)}</ul></section>}
        {isOfficeRole(profile.role) && !job.archived_at && ["asignado", "en_revision"].includes(job.main_status) && <PhotoUpload jobId={job.id} />}
        {photos.length > 0 && <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-lg font-semibold text-ink">Evidencias</h2><p className="mt-1 text-sm text-ink-soft">{photos.length} fotografía(s) confirmada(s)</p><JobEvidenceList photos={photos} canDelete={isOfficeRole(profile.role)} /></section>}
        <ArchiveHistory events={archiveEvents} />
        <Timeline entries={history} />
      </div>
    </AppShell>
  );
}
