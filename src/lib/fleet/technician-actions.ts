"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { FLEET_INCIDENT_SEVERITIES } from "@/lib/fleet/types";

export type TechnicianFleetFormState = {
  success: boolean | null;
  message: string;
  redirectTo?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function formValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function requiredText(formData: FormData, key: string, label: string, max: number): string {
  const input = formValue(formData, key);
  if (!input) throw new Error(`${label} es obligatorio.`);
  if (input.length > max) throw new Error(`${label} es demasiado largo.`);
  return input;
}

function optionalText(formData: FormData, key: string, max: number): string | null {
  const input = formValue(formData, key) || null;
  if (input && input.length > max) throw new Error("Uno de los textos es demasiado largo.");
  return input;
}

function integerValue(formData: FormData, key: string): number {
  const input = formValue(formData, key);
  if (!/^\d+$/u.test(input)) throw new Error("Ingrese un millaje entero válido.");
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("El millaje está fuera del rango permitido.");
  return parsed;
}

function timestampValue(formData: FormData, key: string): string {
  const input = formValue(formData, key);
  if (!input) return new Date().toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) throw new Error("La fecha y hora no son válidas.");
  return parsed.toISOString();
}

function currentDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  }
}

function assertInsertedRow(
  result: { data: { id: string } | null; error: { code?: string; message?: string } | null },
  fallback: string,
  duplicateMessage?: string,
): void {
  if (result.error?.code === "23505" && duplicateMessage) throw new Error(duplicateMessage);
  if (result.error || !result.data) throw new Error(fallback);
}

async function requireCurrentFleetAssignment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  technicianId: string,
  vehicleId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("can_access_fleet_vehicle", {
    check_vehicle_id: vehicleId,
    check_user_id: technicianId,
  });
  if (error || data !== true) throw new Error("Este camión ya no está asignado a tu perfil.");
}

async function fleetTimezone(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { data, error } = await supabase.from("fleet_settings").select("timezone").eq("id", 1).maybeSingle();
  if (error) throw new Error("No se pudo cargar la configuración de millaje.");
  return data?.timezone || "America/New_York";
}

function failure(error: unknown, fallback: string): TechnicianFleetFormState {
  return { success: false, message: error instanceof Error ? error.message : fallback };
}

export async function submitMyFleetOdometerAction(
  _previous: TechnicianFleetFormState,
  formData: FormData,
): Promise<TechnicianFleetFormState> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") return { success: false, message: "Solo los técnicos pueden reportar millaje." };
  try {
    const vehicleId = formValue(formData, "vehicle_id");
    if (!uuidPattern.test(vehicleId)) throw new Error("El camión no es válido.");
    const readingMiles = integerValue(formData, "reading_miles");
    const supabase = await createClient();
    await requireCurrentFleetAssignment(supabase, profile.id, vehicleId);
    const vehicle = await supabase.from("fleet_vehicles").select("current_odometer_miles").eq("id", vehicleId).maybeSingle();
    if (vehicle.error || !vehicle.data) throw new Error("No se pudo verificar el millaje actual del camión.");
    if (readingMiles < Number(vehicle.data.current_odometer_miles)) {
      throw new Error(`El millaje no puede ser menor que ${Number(vehicle.data.current_odometer_miles).toLocaleString("en-US")} mi.`);
    }
    const timezone = await fleetTimezone(supabase);
    const result = await supabase.from("fleet_odometer_readings").insert({
      vehicle_id: vehicleId,
      reading_miles: readingMiles,
      recorded_on: currentDate(timezone),
      source: "weekly",
      shift_id: null,
      notes: optionalText(formData, "notes", 2000),
      submitted_by: profile.id,
      created_by: profile.id,
      updated_by: profile.id,
    }).select("id").maybeSingle();
    assertInsertedRow(result, "No se pudo registrar el millaje. Intente nuevamente.", "Ya registraste el millaje de este camión hoy.");
    revalidatePath("/camiones/mi-camion");
    revalidatePath("/dashboard");
    return { success: true, message: "Millaje registrado correctamente." };
  } catch (error) {
    return failure(error, "No se pudo registrar el millaje.");
  }
}

export async function reportMyFleetIncidentAction(
  _previous: TechnicianFleetFormState,
  formData: FormData,
): Promise<TechnicianFleetFormState> {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") return { success: false, message: "Solo los técnicos pueden reportar incidencias." };
  try {
    const vehicleId = formValue(formData, "vehicle_id");
    if (!uuidPattern.test(vehicleId)) throw new Error("El camión no es válido.");
    const severity = formValue(formData, "severity");
    if (!FLEET_INCIDENT_SEVERITIES.includes(severity as (typeof FLEET_INCIDENT_SEVERITIES)[number])) {
      throw new Error("La severidad seleccionada no es válida.");
    }
    const odometerInput = formValue(formData, "odometer_miles");
    const odometerMiles = odometerInput ? integerValue(formData, "odometer_miles") : null;
    const supabase = await createClient();
    await requireCurrentFleetAssignment(supabase, profile.id, vehicleId);
    const result = await supabase.from("fleet_incidents").insert({
      vehicle_id: vehicleId,
      reported_by: profile.id,
      occurred_at: timestampValue(formData, "occurred_at"),
      severity: severity as (typeof FLEET_INCIDENT_SEVERITIES)[number],
      status: "open",
      title: requiredText(formData, "title", "El título", 200),
      description: requiredText(formData, "description", "La descripción", 5000),
      location: optionalText(formData, "location", 500),
      odometer_miles: odometerMiles,
      resolved_at: null,
      resolved_by: null,
      resolution_notes: null,
      created_by: profile.id,
      updated_by: profile.id,
    }).select("id").maybeSingle();
    assertInsertedRow(result, "No se pudo registrar la incidencia. Intente nuevamente.");
    revalidatePath("/camiones/mi-camion");
    revalidatePath("/camiones");
    return { success: true, message: "Incidencia enviada a la oficina." };
  } catch (error) {
    return failure(error, "No se pudo registrar la incidencia.");
  }
}
