import type { UserRole } from "@/lib/auth/session";
import type { JobStatus, IncidentType } from "./types";

export const JOB_STATUS_ORDER: JobStatus[] = [
  "sin_asignar",
  "asignado",
  "en_progreso",
  "enviado_revision",
  "aprobado",
  "listo_pagar",
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

  // Técnicos solo pueden avanzar estados en flujo normal y gestionar incidencias.
  if (role === "tecnico") {
    if (statusChanged) {
      const currentIndex = JOB_STATUS_ORDER.indexOf(currentStatus);
      const newIndex = JOB_STATUS_ORDER.indexOf(newStatus);

      if (newIndex !== currentIndex + 1) {
        return {
          allowed: false,
          reason: "Solo puedes avanzar al siguiente estado del flujo.",
        };
      }

      // Técnico puede pasar asignado -> en_progreso y en_progreso -> enviado_revision.
      if (
        !(
          (currentStatus === "asignado" && newStatus === "en_progreso") ||
          (currentStatus === "en_progreso" && newStatus === "enviado_revision")
        )
      ) {
        return {
          allowed: false,
          reason: "No tienes permiso para realizar esta transición de estado.",
        };
      }
    }

    if (incidentChanged) {
      // Técnico puede añadir o quitar incidencias.
      if (statusChanged) {
        return {
          allowed: false,
          reason: "No puedes cambiar el estado y la incidencia al mismo tiempo.",
        };
      }
    }

    return { allowed: true };
  }

  // Admin y supervisor pueden realizar cualquier transición de estado válida.
  if (statusChanged) {
    const currentIndex = JOB_STATUS_ORDER.indexOf(currentStatus);
    const newIndex = JOB_STATUS_ORDER.indexOf(newStatus);

    // Permiten retroceder de enviado_revision a en_progreso.
    if (
      !(
        newIndex === currentIndex + 1 ||
        (currentStatus === "enviado_revision" && newStatus === "en_progreso")
      )
    ) {
      return {
        allowed: false,
        reason: "Transición de estado no permitida.",
      };
    }

    if (
      currentStatus === "enviado_revision" &&
      newStatus === "en_progreso" &&
      !reason?.trim()
    ) {
      return {
        allowed: false,
        reason: "Debes indicar un motivo para devolver el trabajo.",
      };
    }
  }

  // Admin y supervisor pueden gestionar incidencias sin cambiar estado.
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
