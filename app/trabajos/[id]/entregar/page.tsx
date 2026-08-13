import { notFound } from "next/navigation";
import { PdfCodeEditor } from "@/components/jobs/pdf-code-editor";
import { requireProfile } from "@/lib/auth/session";
import { getTechnicianJob } from "@/lib/jobs/queries";
import { buildSourcePages, ensureVerifiedDocumentManifest } from "@/lib/jobs/document-manifest";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";

export default async function DeliverJobPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") notFound();
  await requireActiveShiftPage();
  const { id } = await params;
  const detail = await getTechnicianJob(id);
  if (!detail || detail.job.main_status !== "en_progreso" || detail.job.archived_at || !detail.job.project_pdf_url) notFound();
  const sourceDocuments = await ensureVerifiedDocumentManifest(
    createServiceClient(), id, detail.job.project_pdf_url,
  );
  const sourcePages = buildSourcePages(sourceDocuments);
  const initialized = await (await createClient()).rpc("initialize_job_pdf_draft_v2", {
    p_job_id: id,
    p_source_document_ids: sourceDocuments.map((document) => document.id),
    p_page_count: sourcePages.length,
  });
  if (initialized.error || !initialized.data?.[0]) notFound();
  return <PdfCodeEditor jobId={id} catalog={detail.catalog} initialDraft={{
    job_id: id,
    version: initialized.data[0].version,
    source_page_count: initialized.data[0].source_page_count,
    source_document_ids: initialized.data[0].source_document_ids,
    placements: initialized.data[0].placements,
    updated_at: detail.draft?.updated_at ?? new Date().toISOString(),
  }} sourcePages={sourcePages} />;
}
