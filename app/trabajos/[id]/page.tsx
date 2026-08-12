import Link from "next/link";
import { notFound } from "next/navigation";
import { JobForm } from "@/components/jobs/job-form";
import { JobDocuments } from "@/components/jobs/job-documents";
import { JobAttachments } from "@/components/jobs/job-attachments";
import { JobEvidenceList } from "@/components/jobs/job-evidence-list";
import { CodeInput } from "@/components/jobs/code-input";
import { OfficeJobActions } from "@/components/jobs/office-job-actions";
import { PhotoUpload } from "@/components/jobs/photo-upload";
import { TechnicianActions } from "@/components/jobs/technician-actions";
import { Timeline } from "@/components/jobs/timeline";
import { requireProfile } from "@/lib/auth/session";
import { getOfficeJob, getTechnicianJob } from "@/lib/jobs/queries";
import { getJobMapUrl } from "@/lib/jobs/maps";

import { getDeliveredPdfStatus } from "@/lib/jobs/delivered-status";


async function TechnicianDetail({ id }: { id: string }) {
  const detail = await getTechnicianJob(id);
  if (!detail) notFound();
  const { job, history, codes, photos, documents, draft, deliveredDraftVersion, catalog } = detail;
  const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url });
  return <main className="min-h-screen bg-black px-4 py-6 text-white"><div className="mx-auto grid max-w-xl gap-5"><Link href="/trabajos" className="text-sm font-medium text-white">← Mis trabajos</Link><header><p className="text-sm font-semibold uppercase tracking-widest text-white">{job.category.replace("_", " ")}</p><h1 className="mt-1 text-3xl font-bold">{job.title}</h1>{mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-white underline">{job.address || job.location}</a> : <p className="mt-2 text-white">Ubicación no indicada</p>}</header>
    <section className="rounded-2xl bg-black p-5 text-white shadow-lg"><h2 className="text-xl font-bold">Instrucciones</h2><dl className="mt-3 grid gap-3"><div><dt className="font-semibold">Descripción</dt><dd>{job.description || "Sin descripción"}</dd></div><div><dt className="font-semibold">Instrucciones especiales</dt><dd>{job.special_instructions || "Ninguna"}</dd></div><div><dt className="font-semibold">Material requerido</dt><dd>{job.required_material || "No indicado"}</dd></div></dl>{mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-12 items-center font-bold text-white underline">Abrir mapa del proyecto</a>}</section>
    <JobDocuments jobId={job.id} originalPath={job.project_pdf_url} deliveredPath={job.delivered_pdf_path} deliveredStatus={getDeliveredPdfStatus(job, photos.map((photo) => photo.id), draft?.version, deliveredDraftVersion)} jobStatus={job.main_status} />
    <JobAttachments jobId={job.id} documents={documents} canManage={false} />
    <TechnicianActions jobId={job.id} status={job.main_status} incident={job.incident} /><CodeInput jobId={job.id} enabled={job.main_status === "en_progreso"} catalog={catalog} />
    {codes.length > 0 && <section className="rounded-2xl bg-black p-5 text-white"><h2 className="text-xl font-bold">Producción registrada</h2><ul className="mt-3 grid gap-2">{codes.map((code) => <li key={code.id} className="rounded-lg bg-black p-3"><strong>{code.code}</strong> · {code.quantity}{code.notes ? ` · ${code.notes}` : ""}</li>)}</ul></section>}
    {job.main_status === "en_progreso" && <PhotoUpload jobId={job.id} />}{(photos.length > 0 || job.comments) && <section className="rounded-2xl border border-white bg-black p-5 text-white"><h2 className="text-xl font-bold">Evidencia guardada</h2><p className="mt-2 text-white">{photos.length} foto(s)</p>{photos.length > 0 && <JobEvidenceList photos={photos} />}{job.comments && <p className="mt-2 rounded-lg bg-black p-3"><strong>Comentario general:</strong> {job.comments}</p>}</section>}<Timeline entries={history} /></div></main>;
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  if (profile.role === "tecnico") return <TechnicianDetail id={id} />;
  const detail = await getOfficeJob(id);
  if (!detail) notFound();
  const { job, assignment, history, options, photos, codes, documents, draft, deliveredDraftVersion } = detail;
  const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url });
  return <main className="min-h-screen bg-black px-4 py-8 text-white sm:px-8"><div className="mx-auto grid max-w-6xl gap-6"><Link href="/trabajos" className="text-sm font-medium text-white">← Trabajos</Link><header><p className="text-sm font-semibold uppercase tracking-widest text-white">{job.category.replace("_", " ")}</p><h1 className="text-3xl font-bold">{job.prism_number || job.title}</h1><p className="mt-2 text-white">{job.title}</p>{mapUrl && <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-white underline">{job.address || job.location}</a>}<p className="mt-1 text-white">Estado: {job.main_status.replaceAll("_", " ")}{job.incident ? ` · Incidencia: ${job.incident}` : ""}</p>{job.archived_at && <p className="mt-2 border border-white p-3 font-semibold">Archivado: {job.archive_reason || "Sin motivo"}</p>}</header><JobDocuments jobId={job.id} originalPath={job.project_pdf_url} deliveredPath={job.delivered_pdf_path} deliveredStatus={getDeliveredPdfStatus(job, photos.map((photo) => photo.id), draft?.version, deliveredDraftVersion)} jobStatus={job.main_status} canRegenerate canDelete={profile.role === "admin"} /><JobAttachments jobId={job.id} documents={documents} canManage={profile.role === "admin"} /><OfficeJobActions jobId={job.id} status={job.main_status} assignment={assignment} options={options} canArchive={profile.role === "admin"} archived={Boolean(job.archived_at)} /><section className="rounded-2xl border border-white bg-black p-5"><h2 className="mb-3 text-lg font-semibold">Datos del trabajo</h2><div className="text-white"><JobForm job={job} /></div></section>{codes.length > 0 && <section className="rounded-2xl border border-white bg-black p-5"><h2 className="text-lg font-semibold">Producción</h2><ul className="mt-3 grid gap-2">{codes.map((code) => <li key={code.id} className="border border-white p-3"><strong>{code.code}</strong> · {code.quantity} {code.unit_snapshot === "foot" ? "ft" : code.unit_snapshot === "hour" ? "hr" : ""}{code.amount_snapshot !== null ? ` · $${Number(code.amount_snapshot).toFixed(2)}` : ""}</li>)}</ul></section>}{photos.length > 0 && <section className="rounded-2xl border border-white bg-black p-5"><h2 className="text-lg font-semibold">Evidencias</h2><p className="mt-1 text-sm text-white">{photos.length} fotografía(s) confirmada(s)</p><JobEvidenceList photos={photos} /></section>}<Timeline entries={history} /></div></main>;
}
