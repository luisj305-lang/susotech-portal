export const JOB_PDF_VIEW_KINDS = ["original", "delivered"] as const;
export type JobPdfViewKind = (typeof JOB_PDF_VIEW_KINDS)[number];

export const PDF_VIEWER_SIGNED_URL_TTL_SECONDS = 15 * 60;

export function parseJobPdfViewKind(value: string): JobPdfViewKind | null {
  return JOB_PDF_VIEW_KINDS.includes(value as JobPdfViewKind)
    ? value as JobPdfViewKind
    : null;
}

export function resolveJobPdfViewStoragePath(
  jobId: string,
  kind: JobPdfViewKind,
  job: { project_pdf_url: string | null; delivered_pdf_path: string | null },
) {
  const storagePath = kind === "original" ? job.project_pdf_url : job.delivered_pdf_path;
  return typeof storagePath === "string" && storagePath.startsWith(`${jobId}/`)
    ? storagePath
    : null;
}
