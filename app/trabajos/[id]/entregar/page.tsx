import { notFound } from "next/navigation";
import { PdfCodeEditor } from "@/components/jobs/pdf-code-editor";
import { requireProfile } from "@/lib/auth/session";
import { isOperationalFieldWorker } from "@/lib/auth/capabilities";
import { getTechnicianJob } from "@/lib/jobs/queries";
import { buildSourcePages, ensureVerifiedDocumentManifest } from "@/lib/jobs/document-manifest";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";

export default async function DeliverJobPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!isOperationalFieldWorker(profile)) notFound();
  await requireActiveShiftPage();
  const { id } = await params;
  const detail = await getTechnicianJob(id);
  if (!detail || !["asignado", "en_revision"].includes(detail.job.main_status) || detail.job.archived_at || !detail.job.project_pdf_url) notFound();
  const sourceDocuments = await ensureVerifiedDocumentManifest(
    createServiceClient(), id, detail.job.project_pdf_url,
  );
  const sourcePages = buildSourcePages(sourceDocuments);
  const supabase = await createClient();
  const [initialized, participants] = await Promise.all([supabase.rpc("initialize_job_pdf_draft_v4", {
    p_job_id: id,
    p_source_document_ids: sourceDocuments.map((document) => document.id),
    p_page_count: sourcePages.length,
  }), supabase.rpc("list_delivery_allocation_participants")]);
  if (initialized.error || !initialized.data?.[0] || participants.error) notFound();
  return <PdfCodeEditor jobId={id} actorId={profile.id} participants={participants.data ?? []} catalog={detail.catalog} initialDraft={{
    job_id: id,
    version: initialized.data[0].version,
    source_page_count: initialized.data[0].source_page_count,
    source_document_ids: initialized.data[0].source_document_ids,
    placements: initialized.data[0].placements,
    text_notes: initialized.data[0].text_notes,
    lines: initialized.data[0].lines,
    allocations: initialized.data[0].allocations ?? detail.draft?.allocations ?? [],
    updated_at: detail.draft?.updated_at ?? new Date().toISOString(),
  }} sourcePages={sourcePages} />;
}
