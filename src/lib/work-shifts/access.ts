import "server-only";

import { cache } from "react";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_SHIFT_REQUIRED_MESSAGE,
  type ActiveWorkShift,
  type WorkShiftAccess,
  type WorkShiftActor,
} from "./types";

type ActiveShiftClient = {
  rpc: (name: "get_my_active_shift_with_vehicle") => PromiseLike<{
    data: unknown[] | null;
    error: { message?: string } | null;
  }>;
};

export class ActiveShiftRequiredError extends Error {
  readonly code = "active_shift_required" as const;

  constructor() {
    super(ACTIVE_SHIFT_REQUIRED_MESSAGE);
    this.name = "ActiveShiftRequiredError";
  }
}

export function isActiveShiftRequiredError(error: unknown): error is ActiveShiftRequiredError {
  return error instanceof ActiveShiftRequiredError;
}

export async function getWorkShiftAccessForActor(
  actor: WorkShiftActor,
  client?: ActiveShiftClient,
): Promise<WorkShiftAccess> {
  if (actor.role !== "tecnico") {
    return { active: true, bypassed: true, shift: null };
  }

  const supabase = client ?? await createClient();
  const { data, error } = await supabase.rpc("get_my_active_shift_with_vehicle");
  if (error) {
    throw new Error("No se pudo verificar la jornada de trabajo.");
  }

  const shift = ((data ?? [])[0] ?? null) as ActiveWorkShift | null;
  return { active: Boolean(shift), bypassed: false, shift };
}

const getCurrentWorkShiftAccess = cache(async () => {
  const profile = await requireProfile();
  return getWorkShiftAccessForActor(profile);
});

export async function getWorkShiftAccess(): Promise<WorkShiftAccess> {
  return getCurrentWorkShiftAccess();
}

export async function requireActiveShift(): Promise<WorkShiftAccess> {
  return getCurrentWorkShiftAccess();
}

export async function requireActiveShiftPage(): Promise<WorkShiftAccess> {
  return getCurrentWorkShiftAccess();
}
