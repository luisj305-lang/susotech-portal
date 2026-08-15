"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireProfile, requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { authorizeDownload, preparePhotoUpload, prepareProjectUpload } from "./core";
import { confirmBulkProjectUploadCore, prepareBulkProjectUploadCore, type BulkPrepareInput } from "./bulk-import-core";
import { cleanupJobDeletionQueue, type JobDeletionCleanupRow } from "@/lib/jobs/deletion-core";
import { validJobDocumentMetadata } from "./job-document-core";
import {
  isActiveShiftRequiredError,
  requireActiveShift,
} from "@/lib/work-shifts/access";
import { ACTIVE_SHIFT_REQUIRED_MESSAGE } from "@/lib/work-shifts/types";
import {
  isOperationalFieldWorker,
  READ_ONLY_HELPER_MESSAGE,
} from "@/lib/auth/capabilities";

type Bucket = "project-files" | "job-evidence";
type Result<T> = { success: true; message: string; data: T } | { success: false; message: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function requireTechnicianShift(role: "admin" | "supervisor" | "tecnico") {
  if (role !== "tecnico") return null;
  try {
    await requireActiveShift();
    return null;
  } catch (error) {
    if (isActiveShiftRequiredError(error)) {
      return { success: false as const, message: ACTIVE_SHIFT_REQUIRED_MESSAGE };
    }
    throw error;
  }
}

export async function createPhotoUploadUrl(input: {
  jobId: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; size: number;
}): Promise<Result<{ path: string; token: string; signedUrl: string }>> {
  const profile = await requireProfile();
  if (!isOperationalFieldWorker(profile)) {
    return { success: false, message: READ_ONLY_HELPER_MESSAGE };
  }
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  return preparePhotoUpload(await createClient(), input);
}

export async function discardUnconfirmedPhotoUpload(input: {
  jobId: string;
  path: string;
}): Promise<Result<null>> {
  const profile = await requireProfile();
  if (!isOperationalFieldWorker(profile)
    || !uuidPattern.test(input.jobId)
    || !input.path.startsWith(`${input.jobId}/`)
    || input.path.slice(input.jobId.length + 1).includes("/")) {
    return { success: false, message: "La foto no es válida." };
  }

  return {
    success: true,
    message: "Carga descartada de esta pantalla.",
    data: null,
  };
}

export async function createProjectUploadUrl(input: {
  jobId: string; fileName: string; mimeType: string; size: number;
}): Promise<Result<{ path: string; token: string; signedUrl: string }>> {
  await requireSupervisor();
  return prepareProjectUpload(await createClient(), input);
}

export async function prepareJobDocumentUpload(input: {
  jobId: string;
  fileName: string;
  mimeType: string;
  size: number;
  fileHash: string;
}): Promise<Result<{ documentId: string; path: string; token: string; signedUrl: string }>> {
  await requireAdmin();
  if (!validJobDocumentMetadata(input)) {
    return { success: false, message: "El PDF no es válido o supera 25 MB." };
  }

  const supabase = await createClient();
  if (!/^[a-f0-9]{64}$/u.test(input.fileHash)) {
    return { success: false, message: "No se pudo verificar el contenido del PDF." };
  }
  const { data, error } = await supabase.rpc("prepare_job_document_v2", {
    p_job_id: input.jobId,
    p_display_name: input.fileName.trim(),
    p_mime_type: input.mimeType,
    p_size_bytes: input.size,
    p_file_hash: input.fileHash,
  });
  const prepared = data?.[0];
  if (error || !prepared) return { success: false, message: "No se pudo preparar el adjunto." };

  const signed = await supabase.storage.from("project-files").createSignedUploadUrl(prepared.storage_path);
  if (signed.error || !signed.data) {
    const cancelled = await supabase.rpc("delete_job_document", { p_document_id: prepared.document_id });
    if (!cancelled.error) {
      await cleanupJobDeletionQueue(supabase, (cancelled.data ?? []) as JobDeletionCleanupRow[]);
    }
    return { success: false, message: "No se pudo autorizar la carga del adjunto." };
  }
  return {
    success: true,
    message: "Carga preparada.",
    data: {
      documentId: prepared.document_id,
      path: prepared.storage_path,
      token: signed.data.token,
      signedUrl: signed.data.signedUrl,
    },
  };
}

export async function prepareJobOriginalReplacementUpload(input: {
  jobId: string;
  fileName: string;
  mimeType: string;
  size: number;
  fileHash: string;
}): Promise<Result<{ documentId: string; path: string; token: string; signedUrl: string }>> {
  await requireAdmin();
  if (!validJobDocumentMetadata(input) || !/^[a-f0-9]{64}$/u.test(input.fileHash)) {
    return { success: false, message: "El PDF no es válido o supera 25 MB." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_job_original_replacement", {
    p_job_id: input.jobId,
    p_display_name: input.fileName.trim(),
    p_mime_type: input.mimeType,
    p_size_bytes: input.size,
    p_file_hash: input.fileHash,
  });
  const prepared = data?.[0];
  if (error || !prepared) return { success: false, message: "No se pudo preparar el nuevo PDF original." };
  const signed = await supabase.storage.from("project-files").createSignedUploadUrl(prepared.storage_path);
  if (signed.error || !signed.data) {
    await supabase.rpc("discard_job_original_replacement", { p_document_id: prepared.document_id });
    return { success: false, message: "No se pudo autorizar la carga del nuevo PDF original." };
  }
  return {
    success: true,
    message: "Carga preparada.",
    data: {
      documentId: prepared.document_id,
      path: prepared.storage_path,
      token: signed.data.token,
      signedUrl: signed.data.signedUrl,
    },
  };
}

export async function discardJobOriginalReplacementUpload(input: {
  documentId: string;
  jobId: string;
}): Promise<Result<null>> {
  await requireAdmin();
  if (!uuidPattern.test(input.documentId) || !uuidPattern.test(input.jobId)) {
    return { success: false, message: "El reemplazo no es válido." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discard_job_original_replacement", {
    p_document_id: input.documentId,
  });
  if (error) return { success: false, message: "No se pudo descartar el reemplazo." };
  await cleanupJobDeletionQueue(supabase, (data ?? []) as JobDeletionCleanupRow[]);
  revalidatePath(`/trabajos/${input.jobId}`);
  return { success: true, message: "Carga descartada.", data: null };
}

export async function deleteJobDocument(input: { documentId: string; jobId: string }): Promise<Result<null>> {
  await requireAdmin();
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (!validId.test(input.documentId) || !validId.test(input.jobId)) return { success: false, message: "El adjunto no es válido." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_job_document", { p_document_id: input.documentId });
  if (error) return { success: false, message: "No se pudo eliminar el adjunto." };
  const cleanup = await cleanupJobDeletionQueue(supabase, (data ?? []) as JobDeletionCleanupRow[]);
  revalidatePath(`/trabajos/${input.jobId}`);
  return {
    success: true,
    message: cleanup.pending ? "Adjunto retirado; su archivo queda en la cola de limpieza." : "Adjunto eliminado.",
    data: null,
  };
}

export async function reconcileJobDocumentUploads(input: { jobId: string }): Promise<Result<null>> {
  await requireAdmin();
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (!validId.test(input.jobId)) return { success: false, message: "El trabajo no es válido." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reconcile_job_documents", { p_job_id: input.jobId });
  if (error) return { success: false, message: "No se pudieron recuperar las cargas interrumpidas." };
  const result = data?.[0] ?? { activated_count: 0, discarded_count: 0, queued_count: 0 };
  if (result.queued_count) {
    const pending = await supabase.rpc("list_job_deletion_cleanup", { p_limit: 500 });
    if (!pending.error) await cleanupJobDeletionQueue(supabase, (pending.data ?? []) as JobDeletionCleanupRow[]);
  }
  revalidatePath(`/trabajos/${input.jobId}`);
  return {
    success: true,
    message: result.activated_count || result.discarded_count
      ? `Recuperación completada: ${result.activated_count} adjunto(s) confirmado(s), ${result.discarded_count} carga(s) descartada(s).`
      : "No hay cargas interrumpidas con más de 15 minutos.",
    data: null,
  };
}

export async function createSignedDownloadUrl(input: {
  bucket: Bucket; path: string;
}): Promise<Result<{ signedUrl: string; expiresIn: number }>> {
  const profile = await requireProfile();
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  let expiresIn = 60;
  if (profile.role === "tecnico") {
    const access = await requireActiveShift();
    if (access.shift) {
      const remaining = Math.floor(
        (new Date(access.shift.active_until).getTime()
          - new Date(access.shift.server_now).getTime()) / 1000,
      ) - 2;
      if (remaining > 0) expiresIn = Math.min(expiresIn, remaining);
    }
  }
  return authorizeDownload(await createClient(), { ...input, expiresIn });
}

export async function deleteJobPdf(input: {
  jobId: string;
  documentKind: "original" | "delivered";
}): Promise<Result<null>> {
  await requireAdmin();
  if (input.documentKind !== "original" && input.documentKind !== "delivered") {
    return { success: false, message: "El tipo de documento no es válido." };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.jobId)) {
    return { success: false, message: "El trabajo no es válido." };
  }

  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("project_pdf_url, delivered_pdf_path")
    .eq("id", input.jobId)
    .maybeSingle();
  if (jobError || !job) return { success: false, message: "Trabajo no disponible." };

  const path = input.documentKind === "original" ? job.project_pdf_url : job.delivered_pdf_path;
  if (!path) return { success: true, message: "El PDF ya no está disponible.", data: null };
  if (!path.startsWith(`${input.jobId}/`) || !path.toLowerCase().endsWith(".pdf")) {
    return { success: false, message: "La referencia del PDF no es válida." };
  }

  const { error: removeError } = await supabase.storage.from("project-files").remove([path]);
  if (removeError) return { success: false, message: "No se pudo eliminar el PDF privado." };

  const { error: clearError } = await supabase.rpc("clear_job_pdf_reference", {
    p_job_id: input.jobId,
    p_document_kind: input.documentKind,
    p_expected_path: path,
  });
  if (clearError) {
    return { success: false, message: "El archivo se eliminó, pero falta limpiar su referencia. Intenta nuevamente." };
  }

  revalidatePath("/trabajos");
  revalidatePath(`/trabajos/${input.jobId}`);
  return {
    success: true,
    message: input.documentKind === "original" ? "PDF original eliminado." : "PDF entregado eliminado.",
    data: null,
  };
}

export async function prepareBulkProjectUpload(input: BulkPrepareInput) {
  await requireSupervisor();
  return prepareBulkProjectUploadCore(await createClient(), input);
}

export async function confirmBulkProjectUpload(input: { itemId: string; assigneeType?: "technician"; assigneeId?: string }) {
  await requireSupervisor();
  const result = await confirmBulkProjectUploadCore(await createClient(), input);
  if (result.success) revalidatePath("/trabajos");
  return result;
}
