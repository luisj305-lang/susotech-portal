import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeStorageName } from "./names.ts";

export type Bucket = "project-files" | "job-evidence";
export type CoreResult<T> = { success: true; message: string; data: T } | { success: false; message: string };
type PhotoType = "before" | "after" | "evidence";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const imageTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const PDF_LIMIT = 25 * 1024 * 1024;
const PHOTO_LIMIT = 10 * 1024 * 1024;
const ACTIVE_SHIFT_REQUIRED_MESSAGE =
  "Tu jornada de trabajo terminó. Inicia una nueva jornada para continuar.";

function fail<T>(message: string): CoreResult<T> { return { success: false, message }; }

async function readableJob(supabase: SupabaseClient, jobId: string): Promise<CoreResult<true>> {
  if (!uuidPattern.test(jobId)) return fail("Trabajo no disponible.");
  const { data, error } = await supabase.from("jobs").select("id").eq("id", jobId).maybeSingle();
  if (error) return fail(error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : "Trabajo no disponible.");
  return data
    ? { success: true, message: "Trabajo disponible.", data: true }
    : fail("Trabajo no disponible.");
}

async function editableEvidenceJob(supabase: SupabaseClient, jobId: string): Promise<CoreResult<true>> {
  const unavailableMessage = "Solo se puede agregar evidencia mientras el trabajo está en progreso o en revisión.";
  if (!uuidPattern.test(jobId)) return fail(unavailableMessage);
  const { data, error } = await supabase.from("jobs").select("id").eq("id", jobId)
    .in("main_status", ["en_progreso", "enviado_revision"])
    .is("archived_at", null)
    .maybeSingle();
  if (error) return fail(error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : unavailableMessage);
  return data
    ? { success: true, message: "Trabajo editable.", data: true }
    : fail(unavailableMessage);
}

export async function preparePhotoUpload(supabase: SupabaseClient, input: { jobId: string; mimeType: string; size: number }): Promise<CoreResult<{ path: string; token: string; signedUrl: string }>> {
  if (!(input.mimeType in imageTypes) || !Number.isFinite(input.size) || input.size <= 0 || input.size > PHOTO_LIMIT) return fail("La imagen no es válida o supera 10 MB.");
  const editable = await editableEvidenceJob(supabase, input.jobId);
  if (!editable.success) return editable;
  const extension = imageTypes[input.mimeType as keyof typeof imageTypes];
  const path = `${input.jobId}/${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from("job-evidence").createSignedUploadUrl(path);
  if (error || !data) return fail("No se pudo preparar la carga de la foto.");
  return { success: true, message: "Carga preparada.", data: { path, token: data.token, signedUrl: data.signedUrl } };
}

export async function prepareProjectUpload(supabase: SupabaseClient, input: { jobId: string; fileName: string; mimeType: string; size: number }): Promise<CoreResult<{ path: string; token: string; signedUrl: string }>> {
  const fileName = safeStorageName(input.fileName);
  if (!uuidPattern.test(input.jobId) || input.mimeType !== "application/pdf" || !fileName.toLowerCase().endsWith(".pdf") || input.size <= 0 || input.size > PDF_LIMIT) return fail("El PDF no es válido o supera 25 MB.");
  const readable = await readableJob(supabase, input.jobId);
  if (!readable.success) return readable;
  const path = `${input.jobId}/${fileName}`;
  const { data, error } = await supabase.storage.from("project-files").createSignedUploadUrl(path);
  if (error || !data) return fail("No se pudo preparar la carga del PDF.");
  return { success: true, message: "Carga preparada.", data: { path, token: data.token, signedUrl: data.signedUrl } };
}

export async function authorizeDownload(supabase: SupabaseClient, input: { bucket: Bucket; path: string; expiresIn?: number }): Promise<CoreResult<{ signedUrl: string; expiresIn: number }>> {
  const jobId = input.path.split("/", 1)[0];
  if (!input.path.startsWith(`${jobId}/`) || !uuidPattern.test(jobId)) return fail("La ruta no es válida.");
  const readable = await readableJob(supabase, jobId);
  if (!readable.success) return fail(readable.message === ACTIVE_SHIFT_REQUIRED_MESSAGE
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : "Archivo no disponible.");
  const expiresIn = Math.max(1, Math.min(60, Math.floor(input.expiresIn ?? 60)));
  const { data, error } = await supabase.storage.from(input.bucket).createSignedUrl(input.path, expiresIn);
  if (error || !data) return fail("No se pudo autorizar el archivo.");
  return { success: true, message: "Acceso temporal creado.", data: { signedUrl: data.signedUrl, expiresIn } };
}

export async function confirmPhotoEvidence(supabase: SupabaseClient, actorId: string, input: { jobId: string; storagePath: string; photoType: PhotoType; comment?: string | null }): Promise<CoreResult<null>> {
  if (!input.storagePath.startsWith(`${input.jobId}/`) || !["before", "after", "evidence"].includes(input.photoType)) return fail("La foto no es válida.");
  const fileName = input.storagePath.slice(input.jobId.length + 1);
  if (!fileName || fileName.includes("/")) return fail("La ruta de la foto no es válida.");
  const { data: files, error: fileError } = await supabase.storage.from("job-evidence").list(input.jobId, { search: fileName, limit: 2 });
  const stored = files?.find((file) => file.name === fileName);
  const mimeType = stored?.metadata?.mimetype;
  const size = Number(stored?.metadata?.size);
  if (fileError || !stored || typeof mimeType !== "string" || !Object.hasOwn(imageTypes, mimeType) || !Number.isFinite(size) || size <= 0 || size > PHOTO_LIMIT) return fail("El objeto de la foto no es válido.");
  const { data: existing } = await supabase.from("job_photos").select("id").eq("job_id", input.jobId).eq("storage_path", input.storagePath).maybeSingle();
  if (existing) return { success: true, message: "Foto confirmada.", data: null };
  const { error } = await supabase.from("job_photos").insert({ job_id: input.jobId, storage_path: input.storagePath, photo_type: input.photoType, uploaded_by: actorId, comment: input.comment || null });
  if (error) return fail(error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : "No se pudo confirmar la foto.");
  return { success: true, message: "Foto confirmada.", data: null };
}
