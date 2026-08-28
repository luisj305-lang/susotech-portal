"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireProfile, requireSupervisor } from "@/lib/auth/session";
import {
  isOperationalFieldWorker,
  READ_ONLY_HELPER_MESSAGE,
} from "@/lib/auth/capabilities";
import { confirmPhotoEvidence } from "@/lib/storage/core";
import { createClient } from "@/lib/supabase/server";
import { canTransition, INCIDENT_TYPES } from "./state";
import { cleanupJobDeletionQueue, type JobDeletionCleanupRow } from "./deletion-core";
import { validatePlacements, type PdfCodePlacement } from "./pdf-code-editor-core";
import type { AssigneeType, IncidentType, JobCategory, JobStatus } from "./types";
import {
  isActiveShiftRequiredError,
  requireActiveShift,
} from "@/lib/work-shifts/access";
import { ACTIVE_SHIFT_REQUIRED_MESSAGE } from "@/lib/work-shifts/types";

type Result<T = null> =
  | { success: true; message: string; data: T }
  | { success: false; message: string };

type JobInput = {
  title?: string;
  category?: JobCategory;
  prismNumber?: string | null;
  njunsNumber?: string | null;
  address?: string | null;
  location?: string | null;
  customerName?: string | null;
  requestDate?: string | null;
  jobType?: string | null;
  description?: string | null;
  specialInstructions?: string | null;
  requiredMaterial?: string | null;
  projectMapUrl?: string | null;
  assignmentDate?: string | null;
  deadlineDate?: string | null;
  estimatedTotal?: number | null;
};

const categories: JobCategory[] = ["categoria_1", "categoria_2", "categoria_3"];
const photoTypes = ["before", "after", "evidence"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function failure(message: string): Result<never> {
  return { success: false, message };
}

async function requireTechnicianShift(role: "admin" | "supervisor" | "tecnico") {
  if (role !== "tecnico") return null;
  try {
    await requireActiveShift();
    return null;
  } catch (error) {
    if (isActiveShiftRequiredError(error)) return failure(ACTIVE_SHIFT_REQUIRED_MESSAGE);
    throw error;
  }
}

function technicianMutationFailure(
  profile: Awaited<ReturnType<typeof requireProfile>>,
): Result<never> | null {
  return profile.role === "tecnico" && !isOperationalFieldWorker(profile)
    ? failure(READ_ONLY_HELPER_MESSAGE)
    : null;
}

function cleanText(value: unknown, field: string, max = 5000): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw new Error(`${field} no es válido.`);
  return value.trim();
}

function validId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function jobPayload(input: JobInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) {
    payload.title = cleanText(input.title, "El título", 200);
  }
  if (input.category !== undefined) {
    if (!categories.includes(input.category)) throw new Error("La categoría no es válida.");
    payload.category = input.category;
  }
  const textFields = {
    prism_number: input.prismNumber, njuns_number: input.njunsNumber, address: input.address,
    location: input.location, customer_name: input.customerName, job_type: input.jobType, description: input.description,
    special_instructions: input.specialInstructions, required_material: input.requiredMaterial,
    project_map_url: input.projectMapUrl,
  };
  for (const [key, value] of Object.entries(textFields)) {
    if (value !== undefined) payload[key] = cleanText(value, key);
  }
  for (const [key, value] of [["assignment_date", input.assignmentDate], ["deadline_date", input.deadlineDate]] as const) {
    if (value !== undefined) {
      if (value !== null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) throw new Error("La fecha no es válida.");
      payload[key] = value;
    }
  }
  if (input.requestDate !== undefined) {
    if (input.requestDate !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(input.requestDate)) throw new Error("La fecha de solicitud no es válida.");
    payload.request_date = input.requestDate;
  }
  if (input.estimatedTotal !== undefined) {
    if (input.estimatedTotal !== null && (!Number.isFinite(input.estimatedTotal) || input.estimatedTotal < 0)) throw new Error("El total estimado no es válido.");
    payload.estimated_total = input.estimatedTotal;
  }
  return payload;
}

function refresh(jobId?: string) {
  revalidatePath("/trabajos");
  if (jobId) revalidatePath(`/trabajos/${jobId}`);
}

const CREW_RETIREMENT_MESSAGE = "La administración de equipos fue retirada. Usa asignación individual.";

export async function createCrew(input: { name: string; leadTechnicianId: string }): Promise<Result<{ id: string }>> {
  await requireAdmin();
  void input;
  return failure(CREW_RETIREMENT_MESSAGE);
}

export async function updateCrew(input: { crewId: string; name?: string; leadTechnicianId?: string }) {
  await requireAdmin();
  void input;
  return failure(CREW_RETIREMENT_MESSAGE);
}

export async function setCrewActive(input: { crewId: string; active: boolean }) {
  await requireAdmin();
  void input;
  return failure(CREW_RETIREMENT_MESSAGE);
}

export async function addCrewMember(input: { crewId: string; technicianId: string }) {
  await requireAdmin();
  void input;
  return failure(CREW_RETIREMENT_MESSAGE);
}

export async function removeCrewMember(input: { crewId: string; technicianId: string }) {
  await requireAdmin();
  void input;
  return failure(CREW_RETIREMENT_MESSAGE);
}

export async function createJob(input: JobInput): Promise<Result<{ id: string }>> {
  await requireSupervisor();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("jobs").insert(jobPayload(input)).select("id").single();
    if (error || !data) return failure("No se pudo crear el trabajo.");
    refresh(data.id);
    return { success: true, message: "Trabajo creado.", data };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Datos inválidos.");
  }
}

export async function updateJob(input: JobInput & { jobId: string }): Promise<Result> {
  await requireSupervisor();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  try {
    const payload = jobPayload(input);
    if (!Object.keys(payload).length) return failure("No hay cambios que guardar.");
    const supabase = await createClient();
    const { error } = await supabase.from("jobs").update(payload).eq("id", input.jobId).select("id").single();
    if (error) return failure("No se pudo actualizar el trabajo.");
    refresh(input.jobId);
    return { success: true, message: "Trabajo actualizado.", data: null };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Datos inválidos.");
  }
}

async function assign(jobIds: string[], assigneeType: AssigneeType | null, assigneeId: string | null): Promise<Result<{ count: number }>> {
  const ids = [...new Set(jobIds)];
  if (!ids.length || ids.length > 100 || ids.some((id) => !validId(id))) return failure("La asignación no es válida.");
  if ((assigneeType === null) !== (assigneeId === null)) return failure("La asignación no es válida.");
  if (assigneeType !== null && assigneeType !== "technician") return failure("El tipo de asignado no es válido.");
  if (assigneeId !== null && !validId(assigneeId)) return failure("La asignación no es válida.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_jobs_atomic", {
    job_ids: ids, new_assignee_type: assigneeType, new_assignee_id: assigneeId,
  });
  const expectedRows = assigneeType === null ? 0 : ids.length;
  if (error || !data || data.length !== expectedRows) return failure(assigneeType === null ? "No se pudo quitar la asignación." : "No se pudo completar la asignación.");
  ids.forEach((id) => refresh(id));
  return { success: true, message: assigneeType === null ? "Asignación eliminada." : "Asignación completada.", data: { count: ids.length } };
}

export async function assignJob(input: { jobId: string; assigneeType: "technician"; assigneeId: string }) {
  await requireSupervisor();
  return assign([input.jobId], input.assigneeType, input.assigneeId);
}

export async function assignJobsInBulk(input: { jobIds: string[]; assigneeType: "technician"; assigneeId: string }) {
  await requireSupervisor();
  return assign(input.jobIds, input.assigneeType, input.assigneeId);
}

export async function transitionJob(input: { jobId: string; newStatus: JobStatus; reason?: string | null }): Promise<Result> {
  const profile = await requireProfile();
  const capabilityFailure = technicianMutationFailure(profile);
  if (capabilityFailure) return capabilityFailure;
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  if (input.newStatus === "en_revision") {
    return failure("Para enviar el trabajo, usa el editor de entrega.");
  }
  const supabase = await createClient();
  const { data: job, error } = await supabase.from("jobs").select("main_status, incident").eq("id", input.jobId).single();
  if (error || !job) return failure(error?.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : "Trabajo no disponible.");
  const decision = canTransition({ currentStatus: job.main_status, currentIncident: job.incident, newStatus: input.newStatus, newIncident: job.incident, role: profile.role, reason: input.reason });
  if (!decision.allowed) return failure(decision.reason ?? "Transición no permitida.");
  const payload: Record<string, unknown> = { main_status: input.newStatus };
  if (input.reason?.trim()) payload.comments = input.reason.trim();
  const { error: updateError } = await supabase.from("jobs").update(payload).eq("id", input.jobId).select("id").single();
  if (updateError) return failure(updateError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : "No se pudo cambiar el estado.");
  refresh(input.jobId);
  return { success: true, message: "Estado actualizado.", data: null };
}

export async function setIncident(input: { jobId: string; incident: IncidentType | null; notes?: string | null }): Promise<Result> {
  const profile = await requireProfile();
  const capabilityFailure = technicianMutationFailure(profile);
  if (capabilityFailure) return capabilityFailure;
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  if (!validId(input.jobId) || (input.incident !== null && !INCIDENT_TYPES.includes(input.incident))) return failure("La incidencia no es válida.");
  const supabase = await createClient();
  const { data: job, error } = await supabase.from("jobs").select("main_status, incident").eq("id", input.jobId).single();
  if (error || !job) return failure(error?.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : "Trabajo no disponible.");
  const decision = canTransition({ currentStatus: job.main_status, currentIncident: job.incident, newStatus: job.main_status, newIncident: input.incident, role: profile.role });
  if (!decision.allowed) return failure(decision.reason ?? "Cambio no permitido.");
  const notes = cleanText(input.notes, "Las notas", 2000);
  const { error: updateError } = await supabase.from("jobs").update({ incident: input.incident, incident_notes: input.incident ? notes : null }).eq("id", input.jobId).select("id").single();
  if (updateError) return failure(updateError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : "No se pudo guardar la incidencia.");
  refresh(input.jobId);
  return { success: true, message: "Incidencia actualizada.", data: null };
}

export async function addProductionCode(input: { jobId: string; catalogId: string; quantity: number; productionDate?: string | null; notes?: string | null }): Promise<Result> {
  const profile = await requireProfile();
  const capabilityFailure = technicianMutationFailure(profile);
  if (capabilityFailure) return capabilityFailure;
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  if (!validId(input.jobId) || !validId(input.catalogId) || !Number.isFinite(input.quantity) || input.quantity <= 0) return failure("Código o cantidad no válidos.");
  const productionDate = input.productionDate?.trim() || null;
  if (productionDate && !/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) return failure("La fecha de producción no es válida.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_job_production", {
    p_job_id: input.jobId,
    p_catalog_id: input.catalogId,
    p_quantity: input.quantity,
    p_production_date: productionDate,
    p_notes: cleanText(input.notes, "Las notas", 2000),
  });
  if (error) return failure(error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : error.message.includes("price category")
      ? "Tu categoría de precio no está configurada. Contacta a un administrador."
      : error.message.includes("configured rate")
        ? "Este código no tiene tarifa configurada para tu categoría."
        : "No se pudo añadir el código.");
  refresh(input.jobId);
  return { success: true, message: "Código añadido.", data: null };
}

export async function unassignJob(input: { jobId: string }) {
  await requireSupervisor();
  return assign([input.jobId], null, null);
}

const archiveReasonCodes = [
  "duplicate_job",
  "cancelled_by_client_or_office",
  "incorrect_address_or_data",
  "no_access_or_blocked_conditions",
  "out_of_scope",
] as const;

export async function setJobArchived(input: { jobId: string; archived: boolean; reasonCode?: string; notes?: string }): Promise<Result> {
  await requireSupervisor();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const notes = cleanText(input.notes, "Las observaciones", 2000);
  if (input.archived && (!input.reasonCode || !archiveReasonCodes.includes(input.reasonCode as typeof archiveReasonCodes[number]))) {
    return failure("Selecciona un motivo válido para archivar el trabajo.");
  }

  const { error } = await (await createClient()).rpc("set_job_archived_v2", {
    p_job_id: input.jobId,
    p_archived: input.archived,
    p_reason_code: input.reasonCode ?? null,
    p_notes: notes,
  });
  if (error) return failure(input.archived ? "No se pudo archivar el trabajo." : "No se pudo restaurar el trabajo.");
  revalidatePath("/trabajos");
  revalidatePath(`/trabajos/${input.jobId}`);
  return { success: true, message: input.archived ? "Trabajo retirado del dashboard." : "Trabajo restaurado.", data: null };
}

export async function deleteArchivedJob(input: { jobId: string }): Promise<Result> {
  await requireSupervisor();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_archived_job", { p_job_id: input.jobId });
  if (error) {
    if (error.message.includes("Only archived jobs")) {
      return failure("Solo se pueden eliminar permanentemente trabajos archivados.");
    }
    if (error.message.includes("jobs_parent_job_id_fkey")) {
      return failure("No se puede eliminar este trabajo porque tiene partes asociadas.");
    }
    return failure("No se pudo eliminar permanentemente el trabajo.");
  }

  const cleanup = await cleanupJobDeletionQueue(
    supabase,
    (data ?? []) as JobDeletionCleanupRow[],
  );
  revalidatePath("/trabajos");
  revalidatePath(`/trabajos/${input.jobId}`);
  return {
    success: true,
    message: cleanup.pending
      ? `Trabajo eliminado. Quedaron ${cleanup.pending} archivo(s) en la cola de limpieza para reintentar.`
      : "Trabajo eliminado permanentemente.",
    data: null,
  };
}

export async function invoiceJob(input: { jobId: string; invoiceNumber: string; invoicePath?: string | null }): Promise<Result> {
  await requireSupervisor();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const invoiceNumber = cleanText(input.invoiceNumber, "El número de factura", 200);
  if (!invoiceNumber) return failure("El número de factura es obligatorio.");
  const invoicePath = input.invoicePath
    ? cleanText(input.invoicePath, "La ruta de la factura", 1000)
    : null;
  if (invoicePath && !invoicePath.startsWith(`${input.jobId}/`)) {
    return failure("La factura adjunta no es válida.");
  }
  const supabase = await createClient();
  const { data: job, error } = await supabase.from("jobs").select("main_status").eq("id", input.jobId).single();
  if (error || !job) return failure("Trabajo no disponible.");
  if (job.main_status !== "aprobado") return failure("Solo se puede facturar un trabajo aprobado.");
  const { error: updateError } = await supabase.from("jobs")
    .update({ main_status: "facturado", invoice_number: invoiceNumber, invoice_path: invoicePath })
    .eq("id", input.jobId)
    .select("id")
    .single();
  if (updateError) return failure("No se pudo facturar el trabajo.");
  refresh(input.jobId);
  return { success: true, message: "Trabajo facturado.", data: null };
}

export async function correctInvoiceNumber(input: { jobId: string; invoiceNumber: string; invoicePath?: string | null }): Promise<Result> {
  await requireSupervisor();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const invoiceNumber = cleanText(input.invoiceNumber, "El número de factura", 200);
  if (!invoiceNumber) return failure("El número de factura es obligatorio.");
  const invoicePath = input.invoicePath
    ? cleanText(input.invoicePath, "La ruta de la factura", 1000)
    : null;
  if (invoicePath && !invoicePath.startsWith(`${input.jobId}/`)) {
    return failure("La factura adjunta no es válida.");
  }
  const supabase = await createClient();
  const { data: job, error } = await supabase.from("jobs").select("main_status").eq("id", input.jobId).single();
  if (error || !job) return failure("Trabajo no disponible.");
  if (job.main_status === "pagado") return failure("La factura no se puede corregir después del pago.");
  if (job.main_status !== "facturado") return failure("El trabajo todavía no está facturado.");
  const payload: Record<string, unknown> = { invoice_number: invoiceNumber };
  if (input.invoicePath !== undefined) payload.invoice_path = invoicePath;
  const { error: updateError } = await supabase.from("jobs")
    .update(payload)
    .eq("id", input.jobId)
    .select("id")
    .single();
  if (updateError) return failure("No se pudo corregir la factura.");
  refresh(input.jobId);
  return { success: true, message: "Número de factura corregido.", data: null };
}

export async function retryPendingJobDeletionCleanup(): Promise<Result<{ pending: number }>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_job_deletion_cleanup", { p_limit: 500 });
  if (error) return failure("No se pudo cargar la cola de limpieza.");

  const cleanup = await cleanupJobDeletionQueue(
    supabase,
    (data ?? []) as JobDeletionCleanupRow[],
  );
  return {
    success: true,
    message: cleanup.pending
      ? `La limpieza conserva ${cleanup.pending} archivo(s) pendientes para otro reintento.`
      : cleanup.completed
        ? `Limpieza completada para ${cleanup.completed} archivo(s).`
        : "No hay archivos pendientes de limpieza.",
    data: { pending: cleanup.pending },
  };
}

export async function saveJobPdfDraft(input: { jobId: string; expectedVersion: number; pageCount: number; placements: PdfCodePlacement[]; textNotes: import("./pdf-text-note-core").PdfTextNote[]; lines: import("./pdf-line-core").PdfLineAnnotation[]; sourceDocuments: import("./pdf-text-note-core").PdfTextNoteSource[] }): Promise<Result<{ version: number }>> {
  const profile = await requireProfile();
  const capabilityFailure = technicianMutationFailure(profile);
  if (capabilityFailure) return capabilityFailure;
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  if (!validId(input.jobId) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) return failure("El borrador no es válido.");
  const validation = validatePlacements(input.placements, input.pageCount);
  if (validation) return failure(validation);
  const { validatePdfTextNotes } = await import("./pdf-text-note-core");
  const noteValidation = validatePdfTextNotes(input.textNotes, input.sourceDocuments);
  if (noteValidation) return failure(noteValidation);
  const { validatePdfLines } = await import("./pdf-line-core");
  const lineValidation = validatePdfLines(input.lines, input.sourceDocuments);
  if (lineValidation) return failure(lineValidation);
  const { data, error } = await (await createClient()).rpc("save_job_pdf_draft_v4", {
    p_job_id: input.jobId, p_expected_version: input.expectedVersion,
    p_placements: input.placements, p_text_notes: input.textNotes,
    p_lines: input.lines,
  });
  if (error) return failure(error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? ACTIVE_SHIFT_REQUIRED_MESSAGE
    : error.message.includes("PDF source manifest changed")
      ? "El administrador cambió los PDFs del trabajo. Recarga el editor para verlos todos unidos."
    : error.message.includes("version conflict")
      ? "El borrador cambió en otro dispositivo. Recarga antes de guardar."
      : "No se pudo guardar el borrador.");
  revalidatePath(`/trabajos/${input.jobId}`);
  return { success: true, message: "Borrador guardado.", data: { version: Number(data) } };
}

export async function saveJobPdfAllocations(input: { jobId: string; allocations: Array<{ participantId: string; percentage: string }> }): Promise<Result> {
  const profile = await requireProfile();
  const capabilityFailure = technicianMutationFailure(profile);
  if (capabilityFailure) return capabilityFailure;
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const invalid = !Array.isArray(input.allocations) || input.allocations.some((item) => !validId(item.participantId) || !Number.isFinite(Number(item.percentage)) || Number(item.percentage) < 0 || Number(item.percentage) > 100);
  if (invalid) return failure("La distribución no es válida.");
  const { error } = await (await createClient()).rpc("save_job_pdf_allocations", {
    p_job_id: input.jobId,
    p_allocations: input.allocations.map((item) => ({ participantId: item.participantId, percentage: item.percentage })),
  });
  if (error) return failure(error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : "No se pudo guardar la distribución.");
  return { success: true, message: "Distribución guardada.", data: null };
}

export async function addPhotoComment(input: { jobId: string; storagePath?: string; photoType?: typeof photoTypes[number]; comment?: string }): Promise<Result> {
  const profile = await requireProfile();
  const capabilityFailure = technicianMutationFailure(profile);
  if (capabilityFailure) return capabilityFailure;
  const shiftFailure = await requireTechnicianShift(profile.role);
  if (shiftFailure) return shiftFailure;
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const hasPhoto = Boolean(input.storagePath || input.photoType);
  const hasComment = input.comment !== undefined;
  if (!hasPhoto && !hasComment) return failure("Envía una foto o un comentario por operación.");
  const supabase = await createClient();
  if (!hasPhoto && hasComment) {
    const comment = cleanText(input.comment, "El comentario", 5000);
    if (!comment) return failure("El comentario es obligatorio.");
    const { error } = await supabase.from("jobs").update({ comments: comment }).eq("id", input.jobId).select("id").single();
    if (error) return failure(error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : "No se pudo guardar el comentario.");
  } else {
    if (!input.storagePath?.startsWith(`${input.jobId}/`) || !input.photoType || !photoTypes.includes(input.photoType)) return failure("La foto no es válida.");
    let photoComment: string | null = null;
    if (hasComment && input.comment?.trim()) {
      photoComment = cleanText(input.comment, "El comentario de la foto", 2000);
      if (!photoComment) return failure("El comentario de la foto no es válido.");
    }
    const confirmed = await confirmPhotoEvidence(supabase, profile.id, { jobId: input.jobId, storagePath: input.storagePath, photoType: input.photoType, comment: photoComment });
    if (!confirmed.success) return failure(confirmed.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : confirmed.message);
  }
  refresh(input.jobId);
  return { success: true, message: hasPhoto ? "Foto confirmada." : "Comentario guardado.", data: null };
}

export async function deleteJobPhoto(input: { jobId: string; photoId: string }): Promise<Result> {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "supervisor" && !isOperationalFieldWorker(profile)) {
    return failure(READ_ONLY_HELPER_MESSAGE);
  }
  if (!validId(input.jobId) || !validId(input.photoId)) return failure("La fotografía no es válida.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_job_photo_audited", {
    p_photo_id: input.photoId,
  });
  const rows = (data ?? []) as JobDeletionCleanupRow[];
  if (error || !rows.length || rows[0].job_id !== input.jobId) {
    return failure("No se pudo retirar la fotografía de la evidencia.");
  }
  const cleanup = await cleanupJobDeletionQueue(supabase, rows);
  refresh(input.jobId);
  return {
    success: true,
    message: cleanup.pending
      ? "Fotografía retirada. El archivo privado quedó en la cola de limpieza segura."
      : "Fotografía eliminada de la evidencia.",
    data: null,
  };
}

function mapCreateJobPartError(message: string): string {
  if (message.includes("Archived jobs cannot gain parts")) return "Los trabajos archivados no pueden ganar partes.";
  if (message.includes("Only the root job can gain parts")) return "Solo el trabajo raíz puede ganar partes.";
  if (message.includes("Job unavailable")) return "El trabajo no está disponible.";
  if (message.includes("Only active office staff")) return "Solo el personal de oficina puede agregar partes.";
  if (message.includes("foreign key") || message.includes("Foreign key")) return "El trabajo ya no está disponible para agregar partes.";
  return "No se pudo agregar la parte.";
}

export async function createJobPart(input: { jobId: string }): Promise<Result<{ id: string }>> {
  await requireSupervisor();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_job_part", { p_parent_job_id: input.jobId });
  if (error) return failure(mapCreateJobPartError(error.message));
  const row = (data as Array<{ new_job_id: string }> | null)?.[0];
  if (!row?.new_job_id) return failure("No se pudo crear la parte.");
  refresh(input.jobId);
  return { success: true, message: "Parte agregada.", data: { id: row.new_job_id } };
}
