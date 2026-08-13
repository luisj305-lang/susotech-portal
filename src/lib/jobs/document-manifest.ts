import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectPdfDocument } from "./delivered-pdf";

export type VerifiedJobDocument = {
  id: string;
  storage_path: string;
  original_filename: string;
  size_bytes: number;
  file_hash: string;
  page_count: number;
  position: number;
  document_type: "original" | "additional";
};

async function downloadAndInspect(service: SupabaseClient, path: string) {
  const downloaded = await service.storage.from("project-files").download(path);
  if (downloaded.error || !downloaded.data) throw new Error("No se pudo descargar un PDF fuente privado.");
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const { pageCount } = await inspectPdfDocument(bytes);
  return { bytes, pageCount, fileHash: createHash("sha256").update(bytes).digest("hex") };
}

export async function ensureVerifiedDocumentManifest(
  service: SupabaseClient,
  jobId: string,
  originalPath: string,
) {
  const readDocuments = () => service.from("job_documents")
    .select("id,storage_path,original_filename,size_bytes,file_hash,page_count,position,document_type,verification_status")
    .eq("job_id", jobId).eq("status", "active").is("deleted_at", null)
    .order("position", { ascending: true }).order("created_at", { ascending: true });

  let { data: documents, error } = await readDocuments();
  if (error) throw new Error("No se pudieron consultar los PDFs fuente.");
  if (!documents?.some((document) => document.document_type === "original")) {
    const verified = await downloadAndInspect(service, originalPath);
    const originalFileName = originalPath.split("/").at(-1) ?? "original.pdf";
    const ensured = await service.rpc("ensure_job_original_document", {
      p_job_id: jobId,
      p_storage_path: originalPath,
      p_original_filename: originalFileName,
      p_size_bytes: verified.bytes.length,
      p_file_hash: verified.fileHash,
      p_page_count: verified.pageCount,
    });
    if (ensured.error) throw new Error("No se pudo registrar el PDF original.");
    ({ data: documents, error } = await readDocuments());
    if (error) throw new Error("No se pudieron consultar los PDFs fuente.");
  }

  for (const document of documents ?? []) {
    if (document.verification_status === "pdf_verified" && document.file_hash && document.page_count) continue;
    const verified = await downloadAndInspect(service, document.storage_path);
    const result = await service.rpc("verify_job_document_as_service", {
      p_document_id: document.id,
      p_file_hash: verified.fileHash,
      p_page_count: verified.pageCount,
      p_size_bytes: verified.bytes.length,
    });
    if (result.error) throw new Error("No se pudo verificar un PDF fuente.");
  }

  ({ data: documents, error } = await readDocuments());
  if (error) throw new Error("No se pudieron consultar los PDFs fuente.");
  const manifest = (documents ?? []) as VerifiedJobDocument[];
  if (!manifest.length || manifest[0].document_type !== "original"
    || manifest.some((document) => !document.file_hash || !document.page_count)) {
    throw new Error("El conjunto de PDFs fuente no está completo.");
  }
  return manifest;
}

export function buildSourcePages(documents: VerifiedJobDocument[]) {
  let combinedPage = 0;
  return documents.flatMap((document) => Array.from({ length: document.page_count }, (_, index) => ({
    page: ++combinedPage,
    documentId: document.id,
    sourcePage: index + 1,
  })));
}
