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
  work_date?: string | null;
  settlement_due_at?: string | null;
  compensation_mode?: "percentage" | "hourly" | null;
  hourly_rate_cents?: number | null;
};

export type WorkShiftAccess = {
  active: boolean;
  bypassed: boolean;
  shift: ActiveWorkShift | null;
};

export type ShiftCompanion = {
  id: string;
  label: string;
  usage_count?: number;
};

export type WorkShiftActionResult<T = null> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; code?: "active_shift_required" | "invalid_input" | "unavailable" };

export type HourlyShiftSettlement = {
  shift_id: string;
  finished_at: string;
  payable_minutes: number;
  payable_cents: number;
  settled_at: string;
};

export type HourlyPayPeriodRecord = {
  period_start: string;
  period_end_exclusive: string;
  status: "pending" | "approved";
  total_payable_cents: number;
};

export type HourlyOpenShift = {
  started_at: string;
  settlement_due_at: string;
  work_date: string;
};

export type HourlyPayrollSummary =
  | { isHourly: false }
  | {
      isHourly: true;
      hourlyRateCents: number;
      periodStart: string;
      periodEndExclusive: string;
      settledPayableMinutes: number;
      settledPayableCents: number;
      openShift: HourlyOpenShift | null;
      provisionalActiveEstimate: {
        elapsedMinutes: number;
        payableCents: number;
      } | null;
      history: HourlyPayPeriodRecord[];
    };
