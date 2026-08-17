import type { UserRole } from "@/lib/auth/session";
import type { JobStatus, IncidentType } from "./types";

export const JOB_STATUS_ORDER: JobStatus[] = [
  "sin_asignar",
  "asignado",
  "en_revision",
  "aprobado",
  "facturado",
  "pagado",
];

export const INCIDENT_TYPES: IncidentType[] = [
  "need_splicing",
  "no_access",
  "need_cr",
  "permit_pending",
  "returned",
  "incomplete",
];

const OFFICE_ROLES: UserRole[] = ["admin", "supervisor"];

export function isOfficeRole(role: UserRole): boolean {
  return OFFICE_ROLES.includes(role);
}

export interface TransitionInput {
  currentStatus: JobStatus;
  currentIncident: IncidentType | null;
  newStatus: JobStatus;
  newIncident: IncidentType | null;
  role: UserRole;
  reason?: string | null;
}

const OFFICE_TRANSITIONS: ReadonlyArray<readonly [JobStatus, JobStatus]> = [
  ["asignado", "en_revision"],
  ["en_revision", "aprobado"],
  ["en_revision", "asignado"],
  ["aprobado", "facturado"],
  ["facturado", "pagado"],
];

export function canTransition(input: TransitionInput): {
  allowed: boolean;
  reason?: string;
} {
  const {
    currentStatus,
    currentIncident,
    newStatus,
    newIncident,
    role,
    reason,
  } = input;

  const statusChanged = currentStatus !== newStatus;
  const incidentChanged = currentIncident !== newIncident;

  if (!statusChanged && !incidentChanged) {
    return { allowed: false, reason: "No hay cambios que aplicar." };
  }

  // Técnicos solo gestionan incidencias; el estado avanza exclusivamente a
  // través del editor de entrega.
  if (role === "tecnico") {
    if (statusChanged) {
      return {
        allowed: false,
        reason: "Para enviar el trabajo a revisión, usa el editor de entrega.",
      };
    }
    return { allowed: true };
  }

  // Admin y supervisor ejecutan la máquina de estados de oficina.
  if (statusChanged) {
    const allowedTransition = OFFICE_TRANSITIONS.some(
      ([from, to]) => from === currentStatus && to === newStatus,
    );
    if (!allowedTransition) {
      return {
        allowed: false,
        reason: "Transición de estado no permitida.",
      };
    }

    if (
      currentStatus === "en_revision" &&
      newStatus === "asignado" &&
      !reason?.trim()
    ) {
      return {
        allowed: false,
        reason: "Debes indicar un motivo para devolver el trabajo.",
      };
    }
  }

  if (incidentChanged && statusChanged) {
    return {
      allowed: false,
      reason: "No puedes cambiar el estado y la incidencia al mismo tiempo.",
    };
  }

  return { allowed: true };
}

export function nextStatus(status: JobStatus): JobStatus | null {
  const index = JOB_STATUS_ORDER.indexOf(status);
  return JOB_STATUS_ORDER[index + 1] ?? null;
}
