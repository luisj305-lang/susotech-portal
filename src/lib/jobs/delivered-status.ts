import type { DeliveredPdfStatus } from "./types";

export type DeliveredPdfState = {
  delivered_pdf_path?: string | null;
  delivered_pdf_source_photo_ids?: readonly string[] | null;
  delivered_pdf_source_document_ids?: readonly string[] | null;
};

export function getDeliveredPdfStatus(
  job: DeliveredPdfState,
  currentPhotoIds: readonly string[],
  currentDocumentIds: readonly string[],
  draftVersion?: number | null,
  deliveredDraftVersion?: number | null,
): DeliveredPdfStatus {
  if (!job.delivered_pdf_path) return "pending";
  if (draftVersion !== undefined && draftVersion !== null && deliveredDraftVersion !== draftVersion) return "stale";
  const generatedDocuments = [...(job.delivered_pdf_source_document_ids ?? [])];
  if (generatedDocuments.length !== currentDocumentIds.length
    || generatedDocuments.some((id, index) => id !== currentDocumentIds[index])) return "stale";
  const generatedFrom = [...(job.delivered_pdf_source_photo_ids ?? [])].sort();
  const current = [...currentPhotoIds].sort();
  if (generatedFrom.length !== current.length) return "stale";
  return generatedFrom.every((id, index) => id === current[index]) ? "current" : "stale";
}
