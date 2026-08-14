export const USER_ROLES = ["admin", "supervisor", "tecnico"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const WORKER_SPECIALTIES = [
  "tecnico",
  "splicer",
  "liner",
  "ayudante",
] as const;

export type WorkerSpecialty = (typeof WORKER_SPECIALTIES)[number];

export const OPERATIONAL_WORKER_SPECIALTIES = [
  "tecnico",
  "splicer",
  "liner",
] as const satisfies readonly WorkerSpecialty[];

export const READ_ONLY_HELPER_MESSAGE =
  "La especialidad Ayudante tiene acceso de solo lectura.";

export const WORKER_SPECIALTY_LABELS: Record<WorkerSpecialty, string> = {
  tecnico: "Técnico",
  splicer: "Splicer",
  liner: "Liner",
  ayudante: "Ayudante",
};

type WorkerCapabilityProfile = {
  role: UserRole;
  worker_specialty: WorkerSpecialty | null;
};

export function isWorkerSpecialty(value: unknown): value is WorkerSpecialty {
  return WORKER_SPECIALTIES.includes(value as WorkerSpecialty);
}

export function isFieldWorker(
  profile: Pick<WorkerCapabilityProfile, "role">,
): boolean {
  return profile.role === "tecnico";
}

export function isReadOnlyHelper(profile: WorkerCapabilityProfile): boolean {
  return isFieldWorker(profile) && profile.worker_specialty === "ayudante";
}

export function isOperationalFieldWorker(
  profile: WorkerCapabilityProfile,
): boolean {
  return (
    isFieldWorker(profile) &&
    OPERATIONAL_WORKER_SPECIALTIES.includes(
      profile.worker_specialty as (typeof OPERATIONAL_WORKER_SPECIALTIES)[number],
    )
  );
}

export function canMutateJobWork(profile: WorkerCapabilityProfile): boolean {
  return !isFieldWorker(profile) || isOperationalFieldWorker(profile);
}
