import type { SupabaseClient } from "@supabase/supabase-js";
import type { TechnicianDirectoryOption } from "./types";

type CrewClient = Pick<SupabaseClient, "from" | "rpc">;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(`${field} no es válido.`);
  return value;
}

function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error("El nombre del equipo no es válido.");
  return value.trim();
}

export async function listActiveTechniciansCore(client: CrewClient): Promise<TechnicianDirectoryOption[]> {
  const { data, error } = await client.rpc("list_active_technicians_for_office");
  if (error) throw new Error("No se pudo cargar el directorio de técnicos.");
  return (data ?? []).map((row: { id: string; label: string }) => ({ id: row.id, label: row.label }));
}

async function eligible(client: CrewClient, technicianId: string) {
  const technician = id(technicianId, "El técnico");
  if (!(await listActiveTechniciansCore(client)).some((item) => item.id === technician)) {
    throw new Error("El técnico debe estar activo y ser elegible.");
  }
  return technician;
}

export async function createCrewCore(client: CrewClient, input: { name: string; leadTechnicianId: string }) {
  const payload = { name: name(input.name), lead_technician_id: await eligible(client, input.leadTechnicianId) };
  const { data, error } = await client.from("crews").insert(payload).select("id").single();
  if (error || !data) throw new Error("No se pudo crear el equipo.");
  return { id: data.id as string };
}

export async function updateCrewCore(client: CrewClient, input: { crewId: string; name?: string; leadTechnicianId?: string }) {
  const crewId = id(input.crewId, "El equipo");
  const payload: { name?: string; lead_technician_id?: string } = {};
  if (input.name !== undefined) payload.name = name(input.name);
  if (input.leadTechnicianId !== undefined) payload.lead_technician_id = await eligible(client, input.leadTechnicianId);
  if (!Object.keys(payload).length) throw new Error("No hay cambios que guardar.");
  const { error } = await client.from("crews").update(payload).eq("id", crewId).select("id").single();
  if (error) throw new Error("No se pudo actualizar el equipo.");
}

export async function setCrewActiveCore(client: CrewClient, input: { crewId: string; active: boolean }) {
  if (typeof input.active !== "boolean") throw new Error("El estado del equipo no es válido.");
  const { error } = await client.from("crews").update({ is_active: input.active }).eq("id", id(input.crewId, "El equipo")).select("id").single();
  if (error) throw new Error("No se pudo cambiar el estado del equipo.");
}

export async function addCrewMemberCore(client: CrewClient, input: { crewId: string; technicianId: string }) {
  const payload = { crew_id: id(input.crewId, "El equipo"), technician_id: await eligible(client, input.technicianId) };
  const { error } = await client.from("crew_members").insert(payload);
  if (error) throw new Error("No se pudo añadir el integrante.");
}

export async function removeCrewMemberCore(client: CrewClient, input: { crewId: string; technicianId: string }) {
  const crewId = id(input.crewId, "El equipo");
  const technicianId = id(input.technicianId, "El técnico");
  const { data, error } = await client.from("crews").select("lead_technician_id").eq("id", crewId).single();
  if (error || !data) throw new Error("El equipo no está disponible.");
  if (data.lead_technician_id === technicianId) throw new Error("No se puede remover al líder del equipo.");
  const result = await client.from("crew_members").delete().eq("crew_id", crewId).eq("technician_id", technicianId);
  if (result.error) throw new Error("No se pudo remover el integrante.");
}
