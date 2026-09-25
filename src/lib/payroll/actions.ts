"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type PayrollActionResult =
  | { success: true; message: string }
  | { success: false; message: string };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const NEW_YORK_TIME_ZONE = "America/New_York";

/**
 * Converts a New York wall-clock string (`YYYY-MM-DDTHH:mm`) into a valid ISO
 * timestamptz. Mirrors `newYorkTimestampToIso` in `src/lib/work-shifts/actions.ts`
 * so a correction submitted as an ET civil time is never misread as UTC.
 */
function newYorkWallClockToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const civilUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );

  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIME_ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(civilUtc))
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offset) return null;

  const offsetMinutes =
    (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) *
    (offset[1] === "+" ? 1 : -1);
  const result = new Date(civilUtc - offsetMinutes * 60_000);

  const normalized = new Intl.DateTimeFormat("en-CA", {
    timeZone: NEW_YORK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(result);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    normalized.find((item) => item.type === type)?.value;
  if (
    `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}` !==
    value
  ) {
    return null;
  }
  return result.toISOString();
}

function mapApproveError(raw: string | undefined): string {
  const message = raw ?? "";
  if (message.includes("Pay period already approved")) {
    return "El período ya fue aprobado.";
  }
  if (message.includes("Pay period record not found")) {
    return "No se encontró el registro del período.";
  }
  return "No se pudo aprobar el período.";
}

function mapCorrectionError(raw: string | undefined): string {
  const message = raw ?? "";
  if (message.includes("Pay period already approved")) {
    return "El período ya fue aprobado y no se puede corregir.";
  }
  if (message.includes("Shift not eligible for correction")) {
    return "La jornada no es elegible para corrección.";
  }
  if (message.includes("Finished time required")) {
    return "Selecciona una hora de finalización.";
  }
  if (message.includes("Finished time outside shift day")) {
    return "La hora de finalización debe pertenecer al día de la jornada.";
  }
  if (message.includes("Finished time before shift start")) {
    return "La hora de finalización no puede ser anterior al inicio de la jornada.";
  }
  if (message.includes("Finished time after settlement deadline")) {
    return "La hora de finalización supera el plazo de cierre de la jornada.";
  }
  if (message.includes("Shift exceeds 14 hours")) {
    return "La jornada no puede superar las 14 horas.";
  }
  return "No se pudo corregir la jornada.";
}

export async function approveHourlyPayPeriodAction(input: {
  technicianId: string;
  periodStart: string;
}): Promise<PayrollActionResult> {
  try {
    await requireSupervisor();

    if (!uuidPattern.test(input.technicianId) || !datePattern.test(input.periodStart)) {
      return { success: false, message: "Los datos del período no son válidos." };
    }

    const { error } = await (
      await createClient()
    ).rpc("approve_hourly_pay_period_record", {
      p_technician_id: input.technicianId,
      p_period_start: input.periodStart,
    });

    if (error) {
      return { success: false, message: mapApproveError(error.message) };
    }

    revalidatePath("/nomina");
    return { success: true, message: "Período aprobado correctamente." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    return { success: false, message: "No se pudo aprobar el período." };
  }
}

export async function correctHourlyShiftAction(input: {
  shiftId: string;
  finishedAt: string;
  reason: string | null;
}): Promise<PayrollActionResult> {
  try {
    await requireAdmin();

    if (!uuidPattern.test(input.shiftId)) {
      return { success: false, message: "La jornada no es válida." };
    }

    const finishedAt = newYorkWallClockToIso(input.finishedAt?.trim() ?? "");
    if (!finishedAt) {
      return { success: false, message: "La hora de finalización no es válida." };
    }

    const reason = input.reason?.trim() || null;

    const { error } = await (await createClient()).rpc("correct_hourly_shift", {
      p_shift_id: input.shiftId,
      p_finished_at: finishedAt,
      p_reason: reason,
    });

    if (error) {
      return { success: false, message: mapCorrectionError(error.message) };
    }

    revalidatePath("/nomina");
    return { success: true, message: "Jornada corregida correctamente." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    return { success: false, message: "No se pudo corregir la jornada." };
  }
}
