import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireOfficeViewer } from "@/lib/auth/session";
import {
  currentNewYorkPayrollPeriod,
  referenceAtForNewYorkWeek,
} from "@/lib/time/new-york-week";
import type {
  OfficeHourlyPayroll,
  OfficeHourlyShiftRow,
  OfficeHourlyTechnician,
} from "./types";

type DirectoryRow = { id: string; label: string };

type CompensationRow = {
  technician_id: string;
  mode: "percentage" | "hourly";
  hourly_rate_cents: number | null;
};

type PeriodRow = {
  technician_id: string;
  status: "pending" | "approved";
  total_payable_cents: number;
};

type ShiftRow = {
  id: string;
  technician_id: string;
  work_date: string;
  started_at: string;
  finished_at: string | null;
  settled_at: string | null;
  settlement_kind: "self" | "auto" | null;
  payable_minutes: number | null;
  payable_cents: number | null;
  hourly_rate_cents: number | null;
};

/**
 * Office-side hourly payroll snapshot for the Friday–Thursday period at the
 * requested `weekOffset` (0 = current period, negative = past, positive = future).
 * Read-only: it only reads via `createClient()` under office-staff RLS. The
 * technician directory comes from the security-definer
 * `list_active_technicians_for_office` RPC because supervisors cannot read
 * `profiles` directly.
 */
export async function getOfficeHourlyPayroll(
  weekOffset = 0,
): Promise<OfficeHourlyPayroll> {
  await requireOfficeViewer();

  const supabase = await createClient();
  const referenceAt = new Date(referenceAtForNewYorkWeek(weekOffset));
  const { periodStart, periodEndExclusive } =
    currentNewYorkPayrollPeriod(referenceAt);

  const [directoryResult, settingsResult, periodsResult, shiftsResult] =
    await Promise.all([
      supabase.rpc("list_active_technicians_for_office"),
      supabase
        .from("technician_compensation_settings")
        .select("technician_id, mode, hourly_rate_cents"),
      supabase
        .from("technician_pay_period_records")
        .select("technician_id, status, total_payable_cents")
        .eq("period_start", periodStart),
      supabase
        .from("technician_shifts")
        .select(
          "id, technician_id, work_date, started_at, finished_at, settled_at, settlement_kind, payable_minutes, payable_cents, hourly_rate_cents",
        )
        .eq("compensation_mode", "hourly")
        .gte("work_date", periodStart)
        .lt("work_date", periodEndExclusive)
        .order("work_date", { ascending: true })
        .order("started_at", { ascending: true }),
    ]);

  if (
    directoryResult.error ||
    settingsResult.error ||
    periodsResult.error ||
    shiftsResult.error
  ) {
    throw new Error("No se pudo cargar la nómina por horas.");
  }

  const hourlyRates = new Map<string, number>(
    ((settingsResult.data ?? []) as CompensationRow[])
      .filter((row) => row.mode === "hourly")
      .map((row) => [row.technician_id, Number(row.hourly_rate_cents ?? 0)]),
  );

  const periodsByTech = new Map<string, PeriodRow>(
    ((periodsResult.data ?? []) as PeriodRow[]).map((row) => [
      row.technician_id,
      row,
    ]),
  );

  const shiftsByTech = new Map<string, OfficeHourlyShiftRow[]>();
  for (const row of (shiftsResult.data ?? []) as ShiftRow[]) {
    const list = shiftsByTech.get(row.technician_id) ?? [];
    list.push({
      shiftId: row.id,
      workDate: row.work_date,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      settledAt: row.settled_at,
      settlementKind: row.settlement_kind,
      payableMinutes: row.payable_minutes,
      payableCents: row.payable_cents,
      hourlyRateCents: row.hourly_rate_cents,
    });
    shiftsByTech.set(row.technician_id, list);
  }

  const technicians: OfficeHourlyTechnician[] = [];
  for (const row of (directoryResult.data ?? []) as DirectoryRow[]) {
    if (!hourlyRates.has(row.id)) continue;

    const shifts = shiftsByTech.get(row.id) ?? [];
    const period = periodsByTech.get(row.id);
    const settledMinutes = shifts.reduce(
      (sum, shift) =>
        sum + (shift.settledAt ? Number(shift.payableMinutes ?? 0) : 0),
      0,
    );

    technicians.push({
      technicianId: row.id,
      name: row.label,
      hourlyRateCents: hourlyRates.get(row.id) ?? 0,
      periodStatus: period?.status ?? "pending",
      periodTotalPayableCents: Number(period?.total_payable_cents ?? 0),
      periodRecordExists: period !== undefined,
      settledMinutes,
      shifts,
    });
  }

  return {
    periodStart,
    periodEndExclusive,
    isCurrentPeriod: weekOffset === 0,
    technicians,
  };
}
