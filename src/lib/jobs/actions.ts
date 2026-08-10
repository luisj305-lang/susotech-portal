"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireProfile, requireSupervisor } from "@/lib/auth/session";
import { confirmPhotoEvidence } from "@/lib/storage/core";
import { createClient } from "@/lib/supabase/server";
import { canTransition, INCIDENT_TYPES } from "./state";
import { addCrewMemberCore, createCrewCore, removeCrewMemberCore, setCrewActiveCore, updateCrewCore } from "./crew-core";
import type { AssigneeType, IncidentType, JobCategory, JobStatus } from "./types";

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

function cleanText(value: unknown, field: string, max = 5000): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw new Error(`${field} no es válido.`);
  return value.trim();
}

function validId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function jobPayload(input: JobInput, requireTitle: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (requireTitle || input.title !== undefined) {
    const title = cleanText(input.title, "El título", 200);
    if (!title) throw new Error("El título es obligatorio.");
    payload.title = title;
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

function refreshCrews() {
  revalidatePath("/equipos");
  revalidatePath("/trabajos");
  revalidatePath("/trabajos/importar");
}

async function crewMutation(operation: (client: Awaited<ReturnType<typeof createClient>>) => Promise<void>, message: string): Promise<Result> {
  try {
    await operation(await createClient());
    refreshCrews();
    return { success: true, message, data: null };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "No se pudo actualizar el equipo.");
  }
}

export async function createCrew(input: { name: string; leadTechnicianId: string }): Promise<Result<{ id: string }>> {
  await requireAdmin();
  try {
    const data = await createCrewCore(await createClient(), input);
    refreshCrews();
    return { success: true, message: "Equipo creado.", data };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "No se pudo crear el equipo.");
  }
}

export async function updateCrew(input: { crewId: string; name?: string; leadTechnicianId?: string }) {
  await requireAdmin();
  return crewMutation((client) => updateCrewCore(client, input), "Equipo actualizado.");
}

export async function setCrewActive(input: { crewId: string; active: boolean }) {
  await requireAdmin();
  return crewMutation((client) => setCrewActiveCore(client, input), input.active ? "Equipo activado." : "Equipo desactivado.");
}

export async function addCrewMember(input: { crewId: string; technicianId: string }) {
  await requireAdmin();
  return crewMutation((client) => addCrewMemberCore(client, input), "Integrante añadido.");
}

export async function removeCrewMember(input: { crewId: string; technicianId: string }) {
  await requireAdmin();
  return crewMutation((client) => removeCrewMemberCore(client, input), "Integrante removido.");
}

export async function createJob(input: JobInput): Promise<Result<{ id: string }>> {
  await requireSupervisor();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("jobs").insert(jobPayload(input, true)).select("id").single();
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
    const payload = jobPayload(input, false);
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

async function assign(jobIds: string[], assigneeType: AssigneeType, assigneeId: string): Promise<Result<{ count: number }>> {
  const ids = [...new Set(jobIds)];
  if (!ids.length || ids.length > 100 || ids.some((id) => !validId(id)) || !validId(assigneeId)) return failure("La asignación no es válida.");
  if (assigneeType !== "technician" && assigneeType !== "crew") return failure("El tipo de asignado no es válido.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_jobs_atomic", {
    job_ids: ids, new_assignee_type: assigneeType, new_assignee_id: assigneeId,
  });
  if (error || !data || data.length !== ids.length) return failure("No se pudo completar la asignación.");
  ids.forEach((id) => refresh(id));
  return { success: true, message: "Asignación completada.", data: { count: data.length } };
}

export async function assignJob(input: { jobId: string; assigneeType: AssigneeType; assigneeId: string }) {
  await requireSupervisor();
  return assign([input.jobId], input.assigneeType, input.assigneeId);
}

export async function assignJobsInBulk(input: { jobIds: string[]; assigneeType: AssigneeType; assigneeId: string }) {
  await requireSupervisor();
  return assign(input.jobIds, input.assigneeType, input.assigneeId);
}

export async function transitionJob(input: { jobId: string; newStatus: JobStatus; reason?: string | null }): Promise<Result> {
  const profile = await requireProfile();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const supabase = await createClient();
  const { data: job, error } = await supabase.from("jobs").select("main_status, incident").eq("id", input.jobId).single();
  if (error || !job) return failure("Trabajo no disponible.");
  const decision = canTransition({ currentStatus: job.main_status, currentIncident: job.incident, newStatus: input.newStatus, newIncident: job.incident, role: profile.role, reason: input.reason });
  if (!decision.allowed) return failure(decision.reason ?? "Transición no permitida.");
  const payload: Record<string, unknown> = { main_status: input.newStatus };
  if (input.reason?.trim()) payload.comments = input.reason.trim();
  const { error: updateError } = await supabase.from("jobs").update(payload).eq("id", input.jobId).select("id").single();
  if (updateError) return failure("No se pudo cambiar el estado.");
  refresh(input.jobId);
  return { success: true, message: "Estado actualizado.", data: null };
}

export async function setIncident(input: { jobId: string; incident: IncidentType | null; notes?: string | null }): Promise<Result> {
  const profile = await requireProfile();
  if (!validId(input.jobId) || (input.incident !== null && !INCIDENT_TYPES.includes(input.incident))) return failure("La incidencia no es válida.");
  const supabase = await createClient();
  const { data: job, error } = await supabase.from("jobs").select("main_status, incident").eq("id", input.jobId).single();
  if (error || !job) return failure("Trabajo no disponible.");
  const decision = canTransition({ currentStatus: job.main_status, currentIncident: job.incident, newStatus: job.main_status, newIncident: input.incident, role: profile.role });
  if (!decision.allowed) return failure(decision.reason ?? "Cambio no permitido.");
  const notes = cleanText(input.notes, "Las notas", 2000);
  const { error: updateError } = await supabase.from("jobs").update({ incident: input.incident, incident_notes: input.incident ? notes : null }).eq("id", input.jobId).select("id").single();
  if (updateError) return failure("No se pudo guardar la incidencia.");
  refresh(input.jobId);
  return { success: true, message: "Incidencia actualizada.", data: null };
}

export async function addProductionCode(input: { jobId: string; code: string; quantity: number; notes?: string | null }): Promise<Result> {
  const profile = await requireProfile();
  const code = cleanText(input.code, "El código", 100);
  if (!validId(input.jobId) || !code || !Number.isFinite(input.quantity) || input.quantity <= 0) return failure("Código o cantidad no válidos.");
  const supabase = await createClient();
  const { error } = await supabase.from("job_production_codes").insert({ job_id: input.jobId, code, quantity: input.quantity, notes: cleanText(input.notes, "Las notas", 2000), added_by: profile.id });
  if (error) return failure("No se pudo añadir el código.");
  refresh(input.jobId);
  return { success: true, message: "Código añadido.", data: null };
}

export async function addPhotoComment(input: { jobId: string; storagePath?: string; photoType?: typeof photoTypes[number]; comment?: string }): Promise<Result> {
  const profile = await requireProfile();
  if (!validId(input.jobId)) return failure("El trabajo no es válido.");
  const hasPhoto = Boolean(input.storagePath || input.photoType);
  const hasComment = input.comment !== undefined;
  if (hasPhoto === hasComment) return failure("Envía una foto o un comentario por operación.");
  const supabase = await createClient();
  if (hasComment) {
    const comment = cleanText(input.comment, "El comentario", 5000);
    if (!comment) return failure("El comentario es obligatorio.");
    const { error } = await supabase.from("jobs").update({ comments: comment }).eq("id", input.jobId).select("id").single();
    if (error) return failure("No se pudo guardar el comentario.");
  } else {
    if (!input.storagePath?.startsWith(`${input.jobId}/`) || !input.photoType || !photoTypes.includes(input.photoType)) return failure("La foto no es válida.");
    const confirmed = await confirmPhotoEvidence(supabase, profile.id, { jobId: input.jobId, storagePath: input.storagePath, photoType: input.photoType });
    if (!confirmed.success) return failure(confirmed.message);
  }
  refresh(input.jobId);
  return { success: true, message: hasComment ? "Comentario guardado." : "Foto confirmada.", data: null };
}
