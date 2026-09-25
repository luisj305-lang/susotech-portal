import "server-only";

import { cache } from "react";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  currentNewYorkPayrollPeriod,
  newYorkDateString,
} from "@/lib/time/new-york-week";
import type {
  HourlyPayPeriodRecord,
  HourlyPayrollSummary,
} from "./types";

/**
 * Rounds elapsed minutes to the nearest 15-minute increment and estimates the
 * payable cents at the hourly rate, matching the settlement rounding used by
 * `close_my_hourly_shift`.
 */
function provisionalEstimate(startedAt: string, hourlyRateCents: number): {
  elapsedMinutes: number;
  payableCents: number;
} | null {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return null;
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  const roundedMinutes = Math.round(elapsedMinutes / 15) * 15;
  const payableCents = Math.round((roundedMinutes * hourlyRateCents) / 60);
  return { elapsedMinutes: roundedMinutes, payableCents };
}

export const getMyHourlyPayrollSummary = cache(async (): Promise<HourlyPayrollSummary> => {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") {
    return { isHourly: false };
  }

  const supabase = await createClient();

  const { data: settings, error: settingsError } = await supabase
    .from("technician_compensation_settings")
    .select("mode, hourly_rate_cents")
    .eq("technician_id", profile.id)
    .maybeSingle();

  if (settingsError) {
    throw new Error("No se pudo cargar tu configuración de pago.");
  }
  if (!settings || settings.mode !== "hourly") {
    return { isHourly: false };
  }

  const hourlyRateCents = Number(settings.hourly_rate_cents ?? 0);
  const { periodStart, periodEndExclusive } = currentNewYorkPayrollPeriod();
  const today = newYorkDateString();

  const [settledResult, openResult, historyResult] = await Promise.all([
    supabase
      .from("technician_shifts")
      .select("payable_minutes, payable_cents")
      .eq("technician_id", profile.id)
      .eq("compensation_mode", "hourly")
      .not("settled_at", "is", null)
      .gte("work_date", periodStart)
      .lt("work_date", periodEndExclusive),
    supabase
      .from("technician_shifts")
      .select("started_at, settlement_due_at, work_date")
      .eq("technician_id", profile.id)
      .eq("compensation_mode", "hourly")
      .is("settled_at", null)
      .eq("work_date", today)
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("technician_pay_period_records")
      .select("period_start, period_end_exclusive, status, total_payable_cents")
      .eq("technician_id", profile.id)
      .lt("period_start", periodStart)
      .order("period_start", { ascending: false }),
  ]);

  if (settledResult.error || openResult.error || historyResult.error) {
    throw new Error("No se pudo cargar tu resumen de pago por horas.");
  }

  let settledPayableMinutes = 0;
  let settledPayableCents = 0;
  for (const row of (settledResult.data ?? []) as Array<{ payable_minutes: number | null; payable_cents: number | null }>) {
    settledPayableMinutes += Number(row.payable_minutes ?? 0);
    settledPayableCents += Number(row.payable_cents ?? 0);
  }

  const openRow = ((openResult.data ?? [])[0] ?? null) as {
    started_at: string;
    settlement_due_at: string;
    work_date: string;
  } | null;

  return {
    isHourly: true,
    hourlyRateCents,
    periodStart,
    periodEndExclusive,
    settledPayableMinutes,
    settledPayableCents,
    openShift: openRow
      ? { started_at: openRow.started_at, settlement_due_at: openRow.settlement_due_at, work_date: openRow.work_date }
      : null,
    provisionalActiveEstimate: openRow ? provisionalEstimate(openRow.started_at, hourlyRateCents) : null,
    history: (historyResult.data ?? []) as HourlyPayPeriodRecord[],
  };
});
