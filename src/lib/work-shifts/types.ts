import type { CurrentProfile, UserRole } from "@/lib/auth/session";

export const ACTIVE_SHIFT_REQUIRED_MESSAGE =
  "Tu jornada de trabajo terminó. Inicia una nueva jornada para continuar.";

export type WorkShiftActor = Pick<CurrentProfile, "id" | "role"> | {
  id: string;
  role: UserRole;
};

export type ActiveWorkShift = {
  shift_id: string;
  started_at: string;
  active_until: string;
  fuel_amount: string | number;
  no_fuel_today: boolean;
  fuel_photo_path: string | null;
  server_now: string;
  vehicle_id: string | null;
  vehicle_unit_number: string | null;
};

export type WorkShiftAccess = {
  active: boolean;
  bypassed: boolean;
  shift: ActiveWorkShift | null;
};

export type WorkShiftActionResult<T = null> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; code?: "active_shift_required" | "invalid_input" | "unavailable" };
