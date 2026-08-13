"use server";

import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ActiveWorkShift, WorkShiftActionResult } from "./types";

const FUEL_PHOTO_BUCKET = "technician-shift-fuel";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const photoExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
const moneyPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
  if (photoPath && !validFuelPhotoPath(profile.id, photoPath)) {
    return { success: false, message: "La foto de gasolina no es válida.", code: "invalid_input" };
  }

  const { data, error } = await (await createClient()).rpc("start_technician_shift", {
    p_no_fuel_today: input.noFuelToday,
    p_fuel_amount: amount,
    p_fuel_photo_path: photoPath,
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

  const shift = data[0] as ActiveWorkShift;
  revalidatePath("/dashboard");
  revalidatePath("/trabajos");
  revalidatePath("/jornada/iniciar");
  return {
    success: true,
    message: "Jornada iniciada.",
    data: { activeUntil: shift.active_until },
  };
}
