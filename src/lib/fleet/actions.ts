"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  FLEET_ASSIGNMENT_ROLES,
  FLEET_DOCUMENT_TYPES,
  FLEET_EXPENSE_TYPES,
  FLEET_INCIDENT_SEVERITIES,
  FLEET_INCIDENT_STATUSES,
  FLEET_MAINTENANCE_STATUSES,
  FLEET_POLICY_STATUSES,
  FLEET_VEHICLE_STATUSES,
} from "@/lib/fleet/types";

export type FleetFormState = {
  success: boolean | null;
  message: string;
  redirectTo?: string;
};

type FleetDeleteKind =
  | "insurance_policy"
  | "insurance_payment"
  | "maintenance"
  | "expense"
  | "incident"
  | "odometer";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const documentMimeTypes = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function value(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullable(formData: FormData, key: string): string | null {
  return value(formData, key) || null;
}

function validUuid(input: string): boolean {
  return uuidPattern.test(input);
}

function requiredText(formData: FormData, key: string, label: string, max = 5000): string {
  const input = value(formData, key);
  if (!input) throw new Error(`${label} es obligatorio.`);
  if (input.length > max) throw new Error(`${label} es demasiado largo.`);
  return input;
}

function optionalText(formData: FormData, key: string, max = 5000): string | null {
  const input = nullable(formData, key);
  if (input && input.length > max) throw new Error("Uno de los textos es demasiado largo.");
  return input;
}

function dateValue(formData: FormData, key: string, required = false): string | null {
  const input = nullable(formData, key);
  if (!input) {
    if (required) throw new Error("Complete las fechas obligatorias.");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input) || Number.isNaN(Date.parse(`${input}T00:00:00Z`))) {
    throw new Error("Una fecha no es válida.");
  }
  return input;
}

function timestampValue(formData: FormData, key: string): string {
  const input = nullable(formData, key);
  if (!input) return new Date().toISOString();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) throw new Error("La fecha y hora no son válidas.");
  return parsed.toISOString();
}

function integerValue(formData: FormData, key: string, { required = false, max = Number.MAX_SAFE_INTEGER } = {}): number | null {
  const input = nullable(formData, key);
  if (!input) {
    if (required) throw new Error("Complete los valores numéricos obligatorios.");
    return null;
  }
  if (!/^\d+$/u.test(input)) throw new Error("Ingrese un número entero válido.");
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) throw new Error("El número está fuera del rango permitido.");
  return parsed;
}

function moneyCents(formData: FormData, key: string, required = false): number | null {
  const input = nullable(formData, key);
  if (!input) {
    if (required) throw new Error("Complete el importe obligatorio.");
    return null;
  }
  if (!/^\d+(?:\.\d{1,2})?$/u.test(input)) throw new Error("Use un importe válido con hasta dos decimales.");
  const cents = Math.round(Number(input) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("El importe está fuera del rango permitido.");
  return cents;
}

function enumValue<const Values extends readonly string[]>(formData: FormData, key: string, allowed: Values): Values[number] {
  const input = value(formData, key);
  if (!allowed.includes(input)) throw new Error("La opción seleccionada no es válida.");
  return input as Values[number];
}

function databaseMessage(error: { code?: string; message?: string } | null, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23505") return "Ya existe un registro con esos datos únicos.";
  if (error.code === "23P01") return "Las fechas se superponen con una asignación existente.";
  if (error.message?.includes("exactly one current primary")) return "Un camión activo debe conservar exactamente un conductor principal vigente.";
  if (error.message?.includes("active technician")) return "Seleccione un técnico activo.";
  return fallback;
}

function revalidateFleet(vehicleId?: string): void {
  revalidatePath("/camiones");
  if (vehicleId && validUuid(vehicleId)) revalidatePath(`/camiones/${vehicleId}`);
}

function failure(error: unknown, fallback: string): FleetFormState {
  return { success: false, message: error instanceof Error ? error.message : fallback };
}

function assertAffectedRow(
  result: { data: { id: string } | null; error: { code?: string; message?: string } | null },
  fallback: string,
): void {
  if (result.error || !result.data) throw new Error(databaseMessage(result.error, fallback));
}

async function requireInsurancePolicyForVehicle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  policyId: string,
  vehicleId: string,
): Promise<void> {
  const result = await supabase
    .from("fleet_insurance_policies")
    .select("id")
    .eq("id", policyId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
  assertAffectedRow(result, "La póliza no pertenece al camión seleccionado.");
}

export async function createFleetVehicleAction(
  _previous: FleetFormState,
  formData: FormData,
): Promise<FleetFormState> {
  const actor = await requireSupervisor();
  try {
    const currentOdometer = integerValue(formData, "current_odometer_miles") ?? 0;
    const payload = {
      unit_number: requiredText(formData, "unit_number", "El número de unidad", 80),
      vin: nullable(formData, "vin")?.toUpperCase() ?? null,
      license_plate: nullable(formData, "license_plate")?.toUpperCase() ?? null,
      license_state: nullable(formData, "license_state")?.toUpperCase() ?? null,
      make: requiredText(formData, "make", "La marca", 120),
      model: requiredText(formData, "model", "El modelo", 120),
      model_year: integerValue(formData, "model_year", { max: 2200 }),
      color: nullable(formData, "color"),
      status: "draft" as const,
      acquired_on: dateValue(formData, "acquired_on"),
      current_odometer_miles: 0,
      notes: optionalText(formData, "notes"),
    };
    if (payload.model_year !== null && payload.model_year < 1900) throw new Error("El año del modelo no es válido.");
    const supabase = await createClient();
    const { data, error } = await supabase.from("fleet_vehicles").insert(payload).select("id").single();
    if (error || !data) return { success: false, message: databaseMessage(error, "No se pudo crear el camión.") };
    if (currentOdometer > 0) {
      const { error: odometerError } = await supabase.from("fleet_odometer_readings").insert({
        vehicle_id: data.id,
        reading_miles: currentOdometer,
        recorded_on: new Date().toISOString().slice(0, 10),
        source: "manual",
        submitted_by: actor.id,
      });
      if (odometerError) return { success: true, message: "El camión se creó, pero debe registrar nuevamente el millaje inicial.", redirectTo: `/camiones/${data.id}` };
    }
    revalidateFleet(data.id);
    return { success: true, message: "Camión creado. Asigne un conductor principal antes de activarlo.", redirectTo: `/camiones/${data.id}` };
  } catch (error) {
    return failure(error, "No se pudo crear el camión.");
  }
}

export async function updateFleetVehicleAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = value(formData, "vehicle_id");
    if (!validUuid(id)) throw new Error("El camión no es válido.");
    const modelYear = integerValue(formData, "model_year", { max: 2200 });
    if (modelYear !== null && modelYear < 1900) throw new Error("El año del modelo no es válido.");
    const status = enumValue(formData, "status", FLEET_VEHICLE_STATUSES);
    const result = await (await createClient()).from("fleet_vehicles").update({
      unit_number: requiredText(formData, "unit_number", "El número de unidad", 80),
      vin: nullable(formData, "vin")?.toUpperCase() ?? null,
      license_plate: nullable(formData, "license_plate")?.toUpperCase() ?? null,
      license_state: nullable(formData, "license_state")?.toUpperCase() ?? null,
      make: requiredText(formData, "make", "La marca", 120),
      model: requiredText(formData, "model", "El modelo", 120),
      model_year: modelYear,
      color: nullable(formData, "color"),
      status,
      acquired_on: dateValue(formData, "acquired_on"),
      retired_on: status === "retired" ? (dateValue(formData, "retired_on") ?? new Date().toISOString().slice(0, 10)) : null,
      notes: optionalText(formData, "notes"),
    }).eq("id", id).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo actualizar el camión o ya no existe.");
    revalidateFleet(id);
    return { success: true, message: "Datos del camión actualizados." };
  } catch (error) {
    return failure(error, "No se pudo actualizar el camión.");
  }
}

export async function deleteFleetVehicleAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = value(formData, "vehicle_id");
    if (!validUuid(id)) throw new Error("El camión no es válido.");
    const result = await (await createClient()).from("fleet_vehicles").delete().eq("id", id).select("id").maybeSingle();
    assertAffectedRow(result, "No se puede eliminar mientras conserve asignaciones, documentos o registros operativos, o el camión ya no existe.");
    revalidateFleet();
    return { success: true, message: "Camión eliminado.", redirectTo: "/camiones" };
  } catch (error) {
    return failure(error, "No se pudo eliminar el camión.");
  }
}

export async function saveFleetAssignmentAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = nullable(formData, "assignment_id");
    const vehicleId = value(formData, "vehicle_id");
    const technicianId = value(formData, "technician_id");
    if (!validUuid(vehicleId) || !validUuid(technicianId) || (id && !validUuid(id))) throw new Error("La asignación no es válida.");
    const payload = {
      vehicle_id: vehicleId,
      technician_id: technicianId,
      assignment_role: enumValue(formData, "assignment_role", FLEET_ASSIGNMENT_ROLES),
      starts_on: dateValue(formData, "starts_on", true),
      ends_on: dateValue(formData, "ends_on"),
      notes: optionalText(formData, "notes", 2000),
    };
    const supabase = await createClient();
    const result = id
      ? await supabase.from("fleet_vehicle_assignments").update(payload).eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle()
      : await supabase.from("fleet_vehicle_assignments").insert(payload).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo guardar la asignación o no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: id ? "Asignación actualizada." : "Conductor asignado." };
  } catch (error) {
    return failure(error, "No se pudo guardar la asignación.");
  }
}

export async function endFleetAssignmentAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = value(formData, "assignment_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(id) || !validUuid(vehicleId)) throw new Error("La asignación no es válida.");
    const endsOn = dateValue(formData, "ends_on", true);
    const result = await (await createClient()).from("fleet_vehicle_assignments").update({ ends_on: endsOn }).eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo finalizar la asignación o no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: "Asignación finalizada." };
  } catch (error) {
    return failure(error, "No se pudo finalizar la asignación.");
  }
}

export async function deleteFleetAssignmentAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = value(formData, "assignment_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(id) || !validUuid(vehicleId)) throw new Error("La asignación no es válida.");
    const result = await (await createClient()).from("fleet_vehicle_assignments").delete().eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo eliminar la asignación o no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: "Asignación eliminada." };
  } catch (error) {
    return failure(error, "No se pudo eliminar la asignación.");
  }
}

export async function saveFleetInsurancePolicyAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = nullable(formData, "policy_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(vehicleId) || (id && !validUuid(id))) throw new Error("La póliza no es válida.");
    const payload = {
      vehicle_id: vehicleId,
      provider: requiredText(formData, "provider", "La aseguradora", 200),
      policy_number: requiredText(formData, "policy_number", "El número de póliza", 200),
      coverage_type: nullable(formData, "coverage_type"),
      status: enumValue(formData, "status", FLEET_POLICY_STATUSES),
      effective_on: dateValue(formData, "effective_on", true),
      expires_on: dateValue(formData, "expires_on", true),
      payment_due_on: dateValue(formData, "payment_due_on"),
      premium_cents: moneyCents(formData, "premium_dollars"),
      deductible_cents: moneyCents(formData, "deductible_dollars"),
      agent_name: nullable(formData, "agent_name"),
      agent_phone: nullable(formData, "agent_phone"),
      notes: optionalText(formData, "notes"),
    };
    const supabase = await createClient();
    const result = id
      ? await supabase.from("fleet_insurance_policies").update(payload).eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle()
      : await supabase.from("fleet_insurance_policies").insert(payload).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo guardar la póliza o no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: id ? "Póliza actualizada." : "Póliza registrada." };
  } catch (error) {
    return failure(error, "No se pudo guardar la póliza.");
  }
}

export async function saveFleetInsurancePaymentAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = nullable(formData, "payment_id");
    const policyId = value(formData, "policy_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(policyId) || !validUuid(vehicleId) || (id && !validUuid(id))) throw new Error("El pago no es válido.");
    const payload = {
      policy_id: policyId,
      paid_on: dateValue(formData, "paid_on", true),
      amount_cents: moneyCents(formData, "amount_dollars", true),
      payment_method: nullable(formData, "payment_method"),
      reference_number: nullable(formData, "reference_number"),
      notes: optionalText(formData, "notes", 2000),
    };
    const supabase = await createClient();
    await requireInsurancePolicyForVehicle(supabase, policyId, vehicleId);
    const result = id
      ? await supabase.from("fleet_insurance_payments").update(payload).eq("id", id).eq("policy_id", policyId).select("id").maybeSingle()
      : await supabase.from("fleet_insurance_payments").insert(payload).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo guardar el pago o no pertenece a la póliza seleccionada.");
    revalidateFleet(vehicleId);
    return { success: true, message: id ? "Pago actualizado." : "Pago registrado." };
  } catch (error) {
    return failure(error, "No se pudo guardar el pago.");
  }
}

export async function saveFleetMaintenanceAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = nullable(formData, "maintenance_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(vehicleId) || (id && !validUuid(id))) throw new Error("El mantenimiento no es válido.");
    const status = enumValue(formData, "status", FLEET_MAINTENANCE_STATUSES);
    const payload = {
      vehicle_id: vehicleId,
      service_type: requiredText(formData, "service_type", "El tipo de servicio", 200),
      status,
      scheduled_for: dateValue(formData, "scheduled_for"),
      completed_on: status === "completed" ? dateValue(formData, "completed_on", true) : dateValue(formData, "completed_on"),
      odometer_miles: integerValue(formData, "odometer_miles"),
      vendor: nullable(formData, "vendor"),
      cost_cents: moneyCents(formData, "cost_dollars") ?? 0,
      next_due_on: dateValue(formData, "next_due_on"),
      next_due_odometer_miles: integerValue(formData, "next_due_odometer_miles"),
      description: nullable(formData, "description"),
      notes: optionalText(formData, "notes"),
    };
    const supabase = await createClient();
    const result = id
      ? await supabase.from("fleet_maintenance_records").update(payload).eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle()
      : await supabase.from("fleet_maintenance_records").insert(payload).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo guardar el mantenimiento o no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: id ? "Mantenimiento actualizado." : "Mantenimiento registrado." };
  } catch (error) {
    return failure(error, "No se pudo guardar el mantenimiento.");
  }
}

export async function saveFleetExpenseAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = nullable(formData, "expense_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(vehicleId) || (id && !validUuid(id))) throw new Error("El gasto no es válido.");
    const payload = {
      vehicle_id: vehicleId,
      expense_type: enumValue(formData, "expense_type", FLEET_EXPENSE_TYPES),
      occurred_on: dateValue(formData, "occurred_on", true),
      amount_cents: moneyCents(formData, "amount_dollars", true),
      vendor: nullable(formData, "vendor"),
      description: requiredText(formData, "description", "La descripción", 500),
      notes: optionalText(formData, "notes", 2000),
    };
    const supabase = await createClient();
    const result = id
      ? await supabase.from("fleet_expenses").update(payload).eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle()
      : await supabase.from("fleet_expenses").insert(payload).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo guardar el gasto o no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: id ? "Gasto actualizado." : "Gasto registrado." };
  } catch (error) {
    return failure(error, "No se pudo guardar el gasto.");
  }
}

export async function saveFleetIncidentAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  const actor = await requireSupervisor();
  try {
    const id = nullable(formData, "incident_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(vehicleId) || (id && !validUuid(id))) throw new Error("La incidencia no es válida.");
    const status = enumValue(formData, "status", FLEET_INCIDENT_STATUSES);
    const resolved = status === "resolved" || status === "closed";
    const payload = {
      vehicle_id: vehicleId,
      reported_by: id ? undefined : actor.id,
      occurred_at: timestampValue(formData, "occurred_at"),
      severity: enumValue(formData, "severity", FLEET_INCIDENT_SEVERITIES),
      status,
      title: requiredText(formData, "title", "El título", 200),
      description: requiredText(formData, "description", "La descripción"),
      location: nullable(formData, "location"),
      odometer_miles: integerValue(formData, "odometer_miles"),
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? actor.id : null,
      resolution_notes: resolved ? optionalText(formData, "resolution_notes") : null,
    };
    const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, entry]) => entry !== undefined));
    const supabase = await createClient();
    const result = id
      ? await supabase.from("fleet_incidents").update(cleanPayload).eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle()
      : await supabase.from("fleet_incidents").insert(cleanPayload).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo guardar la incidencia o no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: id ? "Incidencia actualizada." : "Incidencia registrada." };
  } catch (error) {
    return failure(error, "No se pudo guardar la incidencia.");
  }
}

async function syncVehicleOdometer(vehicleId: string): Promise<void> {
  const supabase = await createClient();
  const { data, error: readError } = await supabase.from("fleet_odometer_readings").select("reading_miles").eq("vehicle_id", vehicleId).order("reading_miles", { ascending: false }).limit(1).maybeSingle();
  if (readError) throw new Error("No se pudo recalcular el millaje actual del camión.");
  const result = await supabase.from("fleet_vehicles").update({ current_odometer_miles: Number(data?.reading_miles ?? 0) }).eq("id", vehicleId).select("id").maybeSingle();
  assertAffectedRow(result, "No se pudo actualizar el millaje actual del camión.");
}

export async function saveFleetOdometerAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  const actor = await requireSupervisor();
  try {
    const id = nullable(formData, "odometer_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(vehicleId) || (id && !validUuid(id))) throw new Error("La lectura no es válida.");
    const payload = {
      vehicle_id: vehicleId,
      reading_miles: integerValue(formData, "reading_miles", { required: true }),
      recorded_on: dateValue(formData, "recorded_on", true),
      source: "manual" as const,
      shift_id: null,
      notes: optionalText(formData, "notes", 2000),
      submitted_by: actor.id,
    };
    const supabase = await createClient();
    const result = id
      ? await supabase.from("fleet_odometer_readings").update(payload).eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle()
      : await supabase.from("fleet_odometer_readings").insert(payload).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo guardar la lectura o no pertenece a este camión.");
    await syncVehicleOdometer(vehicleId);
    revalidateFleet(vehicleId);
    return { success: true, message: id ? "Lectura corregida." : "Lectura registrada." };
  } catch (error) {
    return failure(error, "No se pudo guardar la lectura.");
  }
}

export async function deleteFleetRecordAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const id = value(formData, "record_id");
    const vehicleId = value(formData, "vehicle_id");
    const kind = value(formData, "record_kind") as FleetDeleteKind;
    if (!validUuid(id) || !validUuid(vehicleId)) throw new Error("El registro no es válido.");
    const tables: Partial<Record<FleetDeleteKind, "fleet_insurance_policies" | "fleet_maintenance_records" | "fleet_expenses" | "fleet_incidents" | "fleet_odometer_readings">> = {
      insurance_policy: "fleet_insurance_policies",
      maintenance: "fleet_maintenance_records",
      expense: "fleet_expenses",
      incident: "fleet_incidents",
      odometer: "fleet_odometer_readings",
    };
    const supabase = await createClient();
    if (kind === "insurance_payment") {
      const payment = await supabase.from("fleet_insurance_payments").select("policy_id").eq("id", id).maybeSingle();
      if (payment.error || !payment.data) throw new Error("El pago ya no está disponible.");
      await requireInsurancePolicyForVehicle(supabase, payment.data.policy_id, vehicleId);
      const result = await supabase.from("fleet_insurance_payments").delete().eq("id", id).eq("policy_id", payment.data.policy_id).select("id").maybeSingle();
      assertAffectedRow(result, "No se pudo eliminar el pago o no pertenece a este camión.");
    } else {
      const table = tables[kind];
      if (!table) throw new Error("El tipo de registro no es válido.");
      const result = await supabase.from(table).delete().eq("id", id).eq("vehicle_id", vehicleId).select("id").maybeSingle();
      assertAffectedRow(result, "No se pudo eliminar el registro o no pertenece a este camión.");
    }
    if (kind === "odometer") await syncVehicleOdometer(vehicleId);
    revalidateFleet(vehicleId);
    return { success: true, message: "Registro eliminado." };
  } catch (error) {
    return failure(error, "No se pudo eliminar el registro.");
  }
}

export type FleetDocumentUploadPreparation =
  | { success: true; message: string; data: { path: string; token: string; signedUrl: string } }
  | { success: false; message: string };

export async function prepareFleetDocumentUpload(input: {
  vehicleId: string;
  mimeType: string;
  size: number;
}): Promise<FleetDocumentUploadPreparation> {
  await requireSupervisor();
  if (!validUuid(input.vehicleId) || !(input.mimeType in documentMimeTypes) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 52_428_800) {
    return { success: false, message: "El archivo no es válido o supera 50 MB." };
  }
  const extension = documentMimeTypes[input.mimeType as keyof typeof documentMimeTypes];
  const path = `${input.vehicleId}/${randomUUID()}.${extension}`;
  const supabase = await createClient();
  const { data: vehicle, error: vehicleError } = await supabase.from("fleet_vehicles").select("id").eq("id", input.vehicleId).maybeSingle();
  if (vehicleError || !vehicle) return { success: false, message: "El camión no está disponible." };
  const { data, error } = await supabase.storage.from("fleet-documents").createSignedUploadUrl(path);
  if (error || !data) return { success: false, message: "No se pudo preparar la carga del documento." };
  return { success: true, message: "Carga preparada.", data: { path, token: data.token, signedUrl: data.signedUrl } };
}

export async function confirmFleetDocumentUpload(input: {
  vehicleId: string;
  path: string;
  title: string;
  documentType: string;
  mimeType: string;
  size: number;
  expiresOn: string | null;
  notes: string;
}): Promise<FleetFormState> {
  const actor = await requireSupervisor();
  try {
    if (!validUuid(input.vehicleId) || !input.path.startsWith(`${input.vehicleId}/`) || !FLEET_DOCUMENT_TYPES.includes(input.documentType as (typeof FLEET_DOCUMENT_TYPES)[number]) || !(input.mimeType in documentMimeTypes) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 52_428_800) {
      throw new Error("Los metadatos del documento no son válidos.");
    }
    const expectedExtension = documentMimeTypes[input.mimeType as keyof typeof documentMimeTypes];
    if (!input.path.endsWith(`.${expectedExtension}`)) throw new Error("El tipo del archivo no coincide con su ruta.");
    const title = input.title.trim();
    if (!title || title.length > 300) throw new Error("El título del documento es obligatorio.");
    const fileName = input.path.slice(input.vehicleId.length + 1);
    if (!fileName || fileName.includes("/")) throw new Error("La ruta del documento no es válida.");
    const supabase = await createClient();
    const { data: objects, error: objectError } = await supabase.storage.from("fleet-documents").list(input.vehicleId, { search: fileName, limit: 2 });
    const object = objects?.find((entry) => entry.name === fileName);
    if (objectError || !object) throw new Error("El archivo cargado no está disponible para confirmar.");
    const storedMimeType = String(object.metadata?.mimetype ?? "").toLowerCase();
    const storedSize = Number(object.metadata?.size);
    if (storedMimeType !== input.mimeType || storedSize !== input.size) {
      throw new Error("El archivo almacenado no coincide con los metadatos enviados.");
    }
    const { error } = await supabase.from("fleet_documents").insert({
      vehicle_id: input.vehicleId,
      document_type: input.documentType as (typeof FLEET_DOCUMENT_TYPES)[number],
      title,
      storage_path: input.path,
      mime_type: input.mimeType,
      size_bytes: input.size,
      expires_on: input.expiresOn || null,
      notes: input.notes.trim() || null,
      uploaded_by: actor.id,
    });
    if (error) throw new Error(databaseMessage(error, "No se pudo confirmar el documento."));
    revalidateFleet(input.vehicleId);
    return { success: true, message: "Documento cargado correctamente." };
  } catch (error) {
    return failure(error, "No se pudo confirmar el documento.");
  }
}

export async function saveFleetDocumentMetadataAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const documentId = value(formData, "document_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(documentId) || !validUuid(vehicleId)) throw new Error("El documento no es válido.");
    const documentType = enumValue(formData, "document_type", FLEET_DOCUMENT_TYPES);
    const result = await (await createClient()).from("fleet_documents").update({
      title: requiredText(formData, "title", "El título", 300),
      document_type: documentType,
      expires_on: dateValue(formData, "expires_on"),
      notes: optionalText(formData, "notes", 2000),
    }).eq("id", documentId).eq("vehicle_id", vehicleId).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudieron actualizar los metadatos o el documento no pertenece a este camión.");
    revalidateFleet(vehicleId);
    return { success: true, message: "Documento actualizado." };
  } catch (error) {
    return failure(error, "No se pudo actualizar el documento.");
  }
}

export async function deleteFleetDocumentAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const documentId = value(formData, "document_id");
    const vehicleId = value(formData, "vehicle_id");
    if (!validUuid(documentId) || !validUuid(vehicleId)) throw new Error("El documento no es válido.");
    const supabase = await createClient();
    const { data, error: readError } = await supabase.from("fleet_documents").select("storage_path").eq("id", documentId).eq("vehicle_id", vehicleId).single();
    if (readError || !data) throw new Error("El documento ya no está disponible.");
    const result = await supabase.from("fleet_documents").delete().eq("id", documentId).eq("vehicle_id", vehicleId).select("id").maybeSingle();
    assertAffectedRow(result, "No se pudo eliminar el documento o no pertenece a este camión.");
    const { error: objectError } = await supabase.storage.from("fleet-documents").remove([data.storage_path]);
    revalidateFleet(vehicleId);
    return objectError
      ? { success: true, message: "El registro se eliminó, pero el archivo requiere limpieza manual." }
      : { success: true, message: "Documento eliminado." };
  } catch (error) {
    return failure(error, "No se pudo eliminar el documento.");
  }
}

export async function setFleetShiftVehicleAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  await requireSupervisor();
  try {
    const shiftId = value(formData, "shift_id");
    const routeVehicleId = value(formData, "route_vehicle_id");
    const targetVehicleId = nullable(formData, "target_vehicle_id");
    if (!validUuid(shiftId) || !validUuid(routeVehicleId) || (targetVehicleId && !validUuid(targetVehicleId))) {
      throw new Error("La asociación de la jornada no es válida.");
    }
    const { data, error } = await (await createClient()).rpc("set_technician_shift_vehicle", {
      p_shift_id: shiftId,
      p_vehicle_id: targetVehicleId,
    });
    const corrected = data?.[0] as { previous_vehicle_id: string | null; vehicle_id: string | null } | undefined;
    if (error || !corrected) return { success: false, message: "No se pudo corregir la asociación de la jornada." };
    revalidateFleet(routeVehicleId);
    if (corrected.previous_vehicle_id) revalidateFleet(corrected.previous_vehicle_id);
    if (corrected.vehicle_id) revalidateFleet(corrected.vehicle_id);
    return { success: true, message: corrected.vehicle_id ? "Jornada asociada al camión seleccionado." : "Asociación de camión eliminada de la jornada." };
  } catch (error) {
    return failure(error, "No se pudo corregir la asociación de la jornada.");
  }
}

export async function saveFleetSettingsAction(_previous: FleetFormState, formData: FormData): Promise<FleetFormState> {
  const actor = await requireSupervisor();
  try {
    const weeklyDay = Number(value(formData, "weekly_odometer_day"));
    if (!Number.isInteger(weeklyDay) || weeklyDay < 0 || weeklyDay > 6) {
      throw new Error("Seleccione un d\u00eda semanal v\u00e1lido.");
    }
    const offsetText = value(formData, "alert_day_offsets");
    if (!offsetText) throw new Error("Ingrese al menos un d\u00eda de anticipaci\u00f3n para las alertas.");
    const offsetEntries = offsetText.split(",").map((entry) => entry.trim());
    if (offsetEntries.some((entry) => !/^\d+$/u.test(entry))) {
      throw new Error("Los d\u00edas de alerta deben ser enteros no negativos separados por comas.");
    }
    const offsets = offsetEntries.map(Number);
    if (offsets.length > 10 || offsets.some((offset) => offset < 0 || offset > 365)) {
      throw new Error("Configure entre 1 y 10 alertas, cada una entre 0 y 365 d\u00edas.");
    }
    const uniqueOffsets = [...new Set(offsets)];
    if (uniqueOffsets.length !== offsets.length) throw new Error("Los d\u00edas de alerta no pueden repetirse.");
    uniqueOffsets.sort((left, right) => right - left);
    const timezone = requiredText(formData, "timezone", "La zona horaria", 100);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
      throw new Error("Ingrese una zona horaria IANA v\u00e1lida, por ejemplo America/New_York.");
    }
    const weeklyRequired = formData.get("weekly_odometer_required") === "true";
    const result = await (await createClient()).from("fleet_settings").upsert({
      id: 1,
      weekly_odometer_day: weeklyDay,
      weekly_odometer_required: weeklyRequired,
      alert_day_offsets: uniqueOffsets,
      timezone,
      created_by: actor.id,
      updated_by: actor.id,
    }, { onConflict: "id" }).select("id").maybeSingle();
    if (result.error || !result.data) throw new Error(databaseMessage(result.error, "No se pudo guardar la configuraci\u00f3n."));
    revalidateFleet();
    return { success: true, message: "Configuraci\u00f3n de alertas guardada." };
  } catch (error) {
    return failure(error, "No se pudo guardar la configuraci\u00f3n de alertas.");
  }
}

export async function runFleetAlertsAction(_previous: FleetFormState, _formData: FormData): Promise<FleetFormState> {
  void _previous;
  void _formData;
  await requireSupervisor();
  try {
    const { data, error } = await (await createClient()).rpc("generate_fleet_alerts");
    const result = data?.[0] as { generated_count: number | string; skipped_count: number | string } | undefined;
    if (error || !result) throw new Error(databaseMessage(error, "No se pudieron generar las alertas."));
    const generated = Number(result.generated_count);
    const skipped = Number(result.skipped_count);
    revalidateFleet();
    return { success: true, message: `Alertas generadas: ${generated}. Duplicadas omitidas: ${skipped}.` };
  } catch (error) {
    return failure(error, "No se pudieron generar las alertas.");
  }
}
