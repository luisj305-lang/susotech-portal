"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Result<T = null> =
  | { success: true; message: string; data: T }
  | { success: false; message: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type AllocationBasisPoint = {
  participantId: string;
  percentageBasisPoints: number;
};

function failure(message: string): Result<never> {
  return { success: false, message };
}

function validId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function mapRosterError(message: string): string {
  if (message.includes("Office access required")) return "No tienes permisos para modificar la distribución.";
  if (message.includes("Job unavailable")) return "El trabajo no está disponible.";
  if (message.includes("Duplicate participants")) return "Los participantes deben ser únicos.";
  if (message.includes("Every participant must be an active technician")) return "Todos los participantes deben ser técnicos activos.";
  if (message.includes("Informational basis points")) return "Los porcentajes informativos no son válidos.";
  return "No se pudo guardar la lista de participantes.";
}

function mapRevisionError(message: string): string {
  if (message.includes("Office access required")) return "No tienes permisos para revisar la distribución.";
  if (message.includes("Job unavailable")) return "El trabajo no está disponible.";
  if (message.includes("Financial allocation is locked")) return "La distribución ya no se puede modificar porque el trabajo está aprobado, facturado, pagado o archivado.";
  if (message.includes("Current submitted delivery unavailable")) return "El trabajo no tiene una entrega vigente.";
  if (message.includes("Allocations contain invalid or duplicate participants")) return "La distribución contiene participantes inválidos o duplicados.";
  if (message.includes("total at most 100.00")) return "Los porcentajes deben ser positivos y sumar como máximo 100.00%.";
  if (message.includes("active field worker")) return "Todos los participantes de la distribución deben ser técnicos activos.";
  if (message.includes("server price snapshot")) return "La entrega no tiene precios confirmados.";
  return "No se pudo actualizar la distribución.";
}

export async function reviseJobAllocations(input: {
  jobId: string;
  allocations: AllocationBasisPoint[];
  participantIds: string[];
}): Promise<Result> {
  await requireSupervisor();

  if (!validId(input.jobId)) return failure("El trabajo no es válido.");

  const allocations = Array.isArray(input.allocations) ? input.allocations : null;
  const participantIds = Array.isArray(input.participantIds) ? input.participantIds : null;

  if (!allocations || allocations.length === 0 || allocations.length > 100) {
    return failure("La distribución no es válida.");
  }
  if (allocations.some((item) => !item || !validId(item.participantId)
    || !Number.isInteger(item.percentageBasisPoints)
    || item.percentageBasisPoints <= 0
    || item.percentageBasisPoints > 10000)) {
    return failure("Cada participante de la distribución debe tener un porcentaje entero positivo.");
  }
  if (new Set(allocations.map((item) => item.participantId)).size !== allocations.length) {
    return failure("Los participantes de la distribución deben ser únicos.");
  }
  if (allocations.reduce((sum, item) => sum + item.percentageBasisPoints, 0) > 10000) {
    return failure("La distribución no puede superar el 100.00%.");
  }

  if (!participantIds || participantIds.length === 0 || participantIds.length > 100) {
    return failure("La lista de participantes no es válida.");
  }
  if (participantIds.some((id) => !validId(id))) {
    return failure("La lista de participantes no es válida.");
  }
  if (new Set(participantIds).size !== participantIds.length) {
    return failure("Los participantes deben ser únicos.");
  }

  const supabase = await createClient();

  // Create the successor money allocation version first: it carries the
  // lifecycle lock boundary and is the money-owning operation.
  const revision = await supabase.rpc("revise_job_financial_allocations", {
    p_job_id: input.jobId,
    p_allocations: allocations,
    p_reason: null,
  });
  if (revision.error) return failure(mapRevisionError(revision.error.message));

  // Persist the full participant roster (percentage + hourly).
  const roster = await supabase.rpc("set_job_work_participants", {
    p_job_id: input.jobId,
    p_participant_ids: participantIds,
  });
  if (roster.error) return failure(mapRosterError(roster.error.message));

  revalidatePath("/trabajos");
  revalidatePath(`/trabajos/${input.jobId}`);
  return { success: true, message: "Distribución actualizada.", data: null };
}
