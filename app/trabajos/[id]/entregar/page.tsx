import { notFound } from "next/navigation";
import { PdfCodeEditor } from "@/components/jobs/pdf-code-editor";
import { requireProfile } from "@/lib/auth/session";
import { getTechnicianJob } from "@/lib/jobs/queries";

export default async function DeliverJobPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") notFound();
  const { id } = await params;
  const detail = await getTechnicianJob(id);
  if (!detail || detail.job.main_status !== "en_progreso" || detail.job.archived_at || !detail.job.project_pdf_url) notFound();
  return <PdfCodeEditor jobId={id} catalog={detail.catalog} initialDraft={detail.draft} />;
}
