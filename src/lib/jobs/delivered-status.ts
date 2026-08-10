import type { DeliveredPdfStatus } from "./types";

export type DeliveredPdfState = {
  delivered_pdf_path?: string | null;
  delivered_pdf_source_photo_ids?: readonly string[] | null;
};

export function getDeliveredPdfStatus(
  job: DeliveredPdfState,
  currentPhotoIds: readonly string[],
): DeliveredPdfStatus {
  if (!job.delivered_pdf_path) return "pending";
  const generatedFrom = [...(job.delivered_pdf_source_photo_ids ?? [])].sort();
  const current = [...currentPhotoIds].sort();
  if (generatedFrom.length !== current.length) return "stale";
  return generatedFrom.every((id, index) => id === current[index]) ? "current" : "stale";
}
