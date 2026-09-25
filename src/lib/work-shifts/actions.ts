"use server";

import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { HourlyShiftSettlement, WorkShiftActionResult } from "./types";

const FUEL_PHOTO_BUCKET = "technician-shift-fuel";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const photoExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
const moneyPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_COMPANIONS = 20;

function validFuelPhotoPath(technicianId: string, path: string) {
  const escapedId = technicianId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escapedId}/[0-9a-f-]{36}\\.(?:jpg|jpeg|png|webp)$`, "iu").test(path)
    && uuidPattern.test(path.slice(technicianId.length + 1).split(".")[0]);
}

export async function prepareFuelPhotoUpload(input: {
  mimeType: string;
  size: number;
}): Promise<WorkShiftActionResult<{ path: string; token: string }>> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") {
    return { success: false, message: "Solo los técnicos pueden iniciar una jornada.", code: "unavailable" };
  }
  if (!(input.mimeType in photoExtensions)
    || !Number.isSafeInteger(input.size)
    || input.size < 1
    || input.size > MAX_PHOTO_BYTES) {
    return { success: false, message: "La foto debe ser JPG, PNG o WebP y no superar 10 MB.", code: "invalid_input" };
  }

  const extension = photoExtensions[input.mimeType as keyof typeof photoExtensions];
  const path = `${profile.id}/${randomUUID()}.${extension}`;
  const { data, error } = await (await createClient()).storage
    .from(FUEL_PHOTO_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return { success: false, message: "No se pudo preparar la foto de gasolina.", code: "unavailable" };
  }
  return { success: true, message: "Carga preparada.", data: { path, token: data.token } };
}

export async function discardFuelPhotoUpload(input: {
  path: string;
}): Promise<WorkShiftActionResult> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico" || !validFuelPhotoPath(profile.id, input.path)) {
    return { success: false, message: "La foto de gasolina no es válida.", code: "invalid_input" };
  }
  return {
    success: true,
    message: "Carga descartada de esta pantalla.",
    data: null,
  };
}

export async function startTechnicianShift(input: {
  noFuelToday: boolean;
  fuelAmount: string;
  fuelPhotoPath?: string | null;
  companionIds?: string[] | null;
}): Promise<WorkShiftActionResult<{ activeUntil: string }>> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") {
    return { success: false, message: "Solo los técnicos pueden iniciar una jornada.", code: "unavailable" };
  }

  const amount = input.fuelAmount.trim();
  const photoPath = input.fuelPhotoPath?.trim() || null;
  const invalidAmount = !moneyPattern.test(amount)
    || (input.noFuelToday ? amount !== "0" : /^0(?:\.0{1,2})?$/u.test(amount));
  if (invalidAmount || (input.noFuelToday && photoPath)) {
    return {
      success: false,
      message: input.noFuelToday
        ? "Selecciona “No cargué gasolina” sin monto ni fotografía."
        : "Ingresa un monto mayor que cero con máximo dos decimales.",
      code: "invalid_input",
    };
  }
  if (!input.noFuelToday && Number(amount) > 200) {
    return {
      success: false,
      message: "El monto de gasolina no puede superar $200.",
      code: "invalid_input",
    };
  }
  if (photoPath && !validFuelPhotoPath(profile.id, photoPath)) {
    return { success: false, message: "La foto de gasolina no es válida.", code: "invalid_input" };
  }

  const companionIds = input.companionIds ?? null;
  if (companionIds
    && (companionIds.length > MAX_COMPANIONS
      || companionIds.some((id) => !id || !uuidPattern.test(id)))) {
    return { success: false, message: "Selecciona compañeros válidos (máximo 20).", code: "invalid_input" };
  }

  const { data, error } = await (await createClient()).rpc("start_technician_shift", {
    p_no_fuel_today: input.noFuelToday,
    p_fuel_amount: amount,
    p_fuel_photo_path: photoPath,
    p_companion_ids: companionIds,
  });
  if (error || !data?.[0]) {
    const duplicate = error?.message.toLowerCase().includes("active shift already exists");
    return {
      success: false,
      message: duplicate
        ? "Ya tienes una jornada activa."
        : "No se pudo iniciar la jornada. Intenta nuevamente.",
      code: "unavailable",
    };
  }

  const shift = data[0] as { active_until: string };
  revalidatePath("/dashboard");
  revalidatePath("/trabajos");
  revalidatePath("/jornada/iniciar");
  revalidatePath("/camiones/mi-camion");
  return {
    success: true,
    message: "Jornada iniciada.",
    data: { activeUntil: shift.active_until },
  };
}

const NEW_YORK_TIME_ZONE = "America/New_York";

/**
 * Converts a New York wall-clock string (`YYYY-MM-DDTHH:mm`) into a valid ISO
 * timestamptz. The UTC offset is resolved for the exact instant and the result
 * is round-tripped through New York formatting so an ambiguous wall time never
 * slips through.
 */
function newYorkTimestampToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const civilUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));

  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(civilUtc)).find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offset) return null;

  const offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === "+" ? 1 : -1);
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
  const part = (type: Intl.DateTimeFormatPartTypes) => normalized.find((item) => item.type === type)?.value;
  if (`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}` !== value) {
    return null;
  }
  return result.toISOString();
}

function closeShiftError(raw: string | undefined): { message: string; code: "invalid_input" | "unavailable" } {
  const message = raw ?? "";
  if (message.includes("No open hourly shift")) {
    return { message: "No tienes una jornada por horas abierta.", code: "unavailable" };
  }
  if (message.includes("Finished time required")) {
    return { message: "Selecciona una hora de finalización.", code: "invalid_input" };
  }
  if (message.includes("Finished time outside shift day")) {
    return { message: "La hora de finalización debe pertenecer al día de la jornada.", code: "invalid_input" };
  }
  if (message.includes("Finished time before shift start")) {
    return { message: "La hora de finalización no puede ser anterior al inicio de la jornada.", code: "invalid_input" };
  }
  if (message.includes("Finished time after settlement deadline")) {
    return { message: "La hora de finalización supera el plazo de cierre de la jornada.", code: "invalid_input" };
  }
  if (message.includes("Shift exceeds 14 hours")) {
    return { message: "La jornada no puede superar las 14 horas.", code: "invalid_input" };
  }
  if (message.includes("Active technician required")) {
    return { message: "Solo los técnicos pueden cerrar una jornada por horas.", code: "unavailable" };
  }
  return { message: "No se pudo cerrar la jornada. Intenta nuevamente.", code: "unavailable" };
}

export async function closeMyHourlyShift(input: {
  finishedAt: string;
}): Promise<WorkShiftActionResult<HourlyShiftSettlement>> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") {
    return { success: false, message: "Solo los técnicos pueden cerrar una jornada por horas.", code: "unavailable" };
  }

  const finishedAt = newYorkTimestampToIso(input.finishedAt?.trim() ?? "");
  if (!finishedAt) {
    return { success: false, message: "La hora de finalización no es válida.", code: "invalid_input" };
  }

  const { data, error } = await (await createClient()).rpc("close_my_hourly_shift", {
    p_finished_at: finishedAt,
  });
  if (error || !data?.[0]) {
    const mapped = closeShiftError(error?.message);
    return { success: false, message: mapped.message, code: mapped.code };
  }

  const settlement = data[0] as HourlyShiftSettlement;
  revalidatePath("/dashboard");
  return {
    success: true,
    message: "Jornada cerrada.",
    data: settlement,
  };
}
