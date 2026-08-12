export const JOB_DOCUMENT_LIMIT = 25 * 1024 * 1024;

export type JobDocumentMetadata = {
  jobId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function validJobDocumentMetadata(input: JobDocumentMetadata): boolean {
  const name = input.fileName.trim();
  return uuidPattern.test(input.jobId)
    && input.mimeType === "application/pdf"
    && name.length > 0
    && name.length <= 255
    && name.toLowerCase().endsWith(".pdf")
    && Number.isSafeInteger(input.size)
    && input.size >= 1
    && input.size <= JOB_DOCUMENT_LIMIT;
}
