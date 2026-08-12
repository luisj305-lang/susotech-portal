import type { SupabaseClient } from "@supabase/supabase-js";
import type { PdfDraft } from "../jobs/pdf-parser";
import { safeStorageName } from "./names.ts";

const PDF_LIMIT = 25 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/u;
type PrepareFailureReason =
  | "batch_unavailable"
  | "batch_limit_exceeded"
  | "invalid_metadata"
  | "network_error"
  | "permission_denied"
  | "prepare_failed"
  | "upload_authorization_failed";
type Result<T, TReason extends string = string> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; reason?: TReason };
export type BulkPrepareInput = { batchId: string | null; fileName: string; fileHash: string; fileSize: number; mimeType: string; pdfHeader: string; fields: PdfDraft };
type Prepared = { batchId: string; itemId: string; jobId: string; path: string; status: string; token?: string; signedUrl?: string };

function fail<T, TReason extends string = string>(message: string, reason?: TReason): Result<T, TReason> {
  return reason ? { success: false, message, reason } : { success: false, message };
}

function isBatchUnavailable(error: { code?: string; message?: string } | null) {
  return error?.code === "P0001" && /batch unavailable/iu.test(error.message ?? "");
}

function prepareRpcFailure(error: { code?: string; message?: string } | null): Result<never, PrepareFailureReason> {
  const message = error?.message ?? "";
  if (isBatchUnavailable(error)) {
    return fail("El lote guardado ya no está disponible. Se iniciará un lote nuevo.", "batch_unavailable");
  }
  if (/invalid import metadata/iu.test(message)) {
    return fail("Los metadatos extraídos del PDF no son válidos.", "invalid_metadata");
  }
  if (/batch limit exceeded/iu.test(message)) {
    return fail("El lote alcanzó el máximo de 100 archivos. Inicia un lote nuevo.", "batch_limit_exceeded");
  }
  if (/only active office staff can import jobs|permission denied/iu.test(message) || error?.code === "42501") {
    return fail("Tu usuario no tiene permiso para importar trabajos.", "permission_denied");
  }
  if (/failed to fetch|fetch failed|network error/iu.test(message)) {
    return fail("No se pudo contactar al servidor para preparar el PDF.", "network_error");
  }
  return fail(`No se pudo preparar el item de importación (${error?.code ?? "sin código"}).`, "prepare_failed");
}
function valid(input: BulkPrepareInput) {
  const name = safeStorageName(input.fileName);
  return name.toLowerCase().endsWith(".pdf") && input.mimeType === "application/pdf"
    && Number.isSafeInteger(input.fileSize) && input.fileSize > 0 && input.fileSize <= PDF_LIMIT
    && hashPattern.test(input.fileHash) && input.pdfHeader === "%PDF-" && input.fields.title.trim().length > 0
    && Object.values(input.fields).every((value) => value === null || typeof value === "string");
}

export async function prepareBulkProjectUploadCore(
  supabase: SupabaseClient,
  input: BulkPrepareInput,
): Promise<Result<Prepared, PrepareFailureReason>> {
  if (!valid(input)) return fail("Los metadatos del PDF no son válidos o superan 25 MB.", "invalid_metadata");
  const { data, error } = await supabase.rpc("prepare_job_import_item", {
    p_batch_id: input.batchId, p_source_file_name: input.fileName, p_stored_file_name: safeStorageName(input.fileName),
    p_source_file_hash: input.fileHash, p_source_file_size: input.fileSize, p_source_mime_type: input.mimeType,
    p_declared_pdf_header: input.pdfHeader, p_fields: input.fields,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row?.item_id) {
    // Do not log filenames, parsed fields, hashes, or credentials. The database
    // error identity is enough to diagnose the failed preparation server-side.
    console.error("[bulk-import] prepare_job_import_item failed", {
      code: error?.code ?? "missing_row",
      message: error?.message ?? "RPC returned no import item",
      details: error?.details ?? null,
    });
    return prepareRpcFailure(error);
  }
  const prepared: Prepared = { batchId: row.batch_id, itemId: row.item_id, jobId: row.proposed_job_id, path: row.storage_path, status: row.item_status };
  if (row.confirmed_job_id) return { success: true, message: "El PDF ya estaba confirmado.", data: { ...prepared, jobId: row.confirmed_job_id } };
  const signed = await supabase.storage.from("project-files").createSignedUploadUrl(row.storage_path, { upsert: true });
  if (signed.error || !signed.data) return fail("No se pudo autorizar la carga privada.", "upload_authorization_failed");
  return { success: true, message: "Carga preparada.", data: { ...prepared, token: signed.data.token, signedUrl: signed.data.signedUrl } };
}

export async function confirmBulkProjectUploadCore(supabase: SupabaseClient, input: { itemId: string }): Promise<Result<{ status: string; jobId: string }>> {
  const { data: item, error } = await supabase.from("job_import_items").select("batch_id,item_id,proposed_job_id,storage_path,item_status,confirmed_job_id,source_file_name,source_file_hash,source_file_size,source_mime_type,declared_pdf_header").eq("item_id", input.itemId).single();
  if (error || !item) return fail("Item de importación no disponible.");
  if (item.confirmed_job_id) return { success: true, message: "Importación ya confirmada.", data: { status: item.item_status, jobId: item.confirmed_job_id } };
  const parts = item.storage_path.split("/"); const fileName = parts.pop(); const folder = parts.join("/");
  const listed = await supabase.storage.from("project-files").list(folder, { search: fileName, limit: 2 });
  const object = listed.data?.find((entry) => entry.name === fileName);
  if (listed.error || !object || object.metadata?.mimetype !== item.source_mime_type || Number(object.metadata?.size) !== Number(item.source_file_size)) return fail("El objeto cargado no coincide con los metadatos autorizados.");
  const signed = await supabase.storage.from("project-files").createSignedUrl(item.storage_path, 60);
  if (signed.error || !signed.data) return fail("No se pudo verificar el PDF privado.");
  const response = await fetch(signed.data.signedUrl, { headers: { Range: "bytes=0-4" }, cache: "no-store" });
  const contentRange = response.headers.get("content-range") ?? "";
  if (response.status !== 206 || !/^bytes 0-4\/\d+$/u.test(contentRange) || (await response.text()) !== item.declared_pdf_header) return fail("La cabecera real del objeto no es PDF.");
  const confirmed = await supabase.rpc("confirm_job_import_item", { p_item_id: item.item_id });
  const row = Array.isArray(confirmed.data) ? confirmed.data[0] : null;
  if (confirmed.error || !row?.confirmed_job_id) return fail("No se pudo confirmar el trabajo.");
  if (row.result_status === "duplicate") await supabase.storage.from("project-files").remove([item.storage_path]);
  return { success: true, message: row.result_status === "duplicate" ? "Duplicado." : "Importado.", data: { status: row.result_status, jobId: row.confirmed_job_id } };
}
