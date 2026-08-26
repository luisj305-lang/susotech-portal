"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  getCalendarConnection,
  listGoogleCalendars,
  updateGoogleEvent,
} from "@/lib/calendar/google";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function messageRedirect(message: string, kind: "ok" | "error" = "ok"): never {
  redirect(`/calendario?${kind}=${encodeURIComponent(message)}`);
}

function newYorkDateTime(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(Number.NaN);
  const [, year, month, day, hour, minute] = match;
  const civilUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(civilUtc)).find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName ?? "");
  if (!offset) return new Date(Number.NaN);
  const minutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === "+" ? 1 : -1);
  const result = new Date(civilUtc - minutes * 60_000);
  const normalized = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(result);
  const part = (type: Intl.DateTimeFormatPartTypes) => normalized.find((item) => item.type === type)?.value;
  if (`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}` !== value) return new Date(Number.NaN);
  return result;
}

function reminderInput(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const startsAt = newYorkDateTime(String(formData.get("startsAt") ?? ""));
  const endsAt = newYorkDateTime(String(formData.get("endsAt") ?? ""));
  if (!title || title.length > 160) throw new Error("El título debe tener entre 1 y 160 caracteres.");
  if (notes.length > 4000) throw new Error("Las notas no pueden superar 4000 caracteres.");
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new Error("El rango de fecha y hora no es válido.");
  }
  return { title, notes: notes || null, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() };
}

export async function createReminder(formData: FormData) {
  const profile = await requireAdmin();
  try {
    const input = reminderInput(formData);
    const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
    if (!UUID.test(idempotencyKey)) throw new Error("La solicitud no es válida. Recarga la página.");
    const service = createServiceClient();
    const { data: existing } = await service.from("calendar_reminders").select("*")
      .eq("created_by", profile.id).eq("idempotency_key", idempotencyKey).maybeSingle();
    let reminder = existing;
    if (!reminder) {
      const { data, error } = await service.from("calendar_reminders").insert({
        ...input, created_by: profile.id, idempotency_key: idempotencyKey,
      }).select("*").single();
      if (error || !data) throw new Error("No se pudo guardar el evento.");
      reminder = data;
    }
    if (!reminder.google_event_id) {
      const connection = await getCalendarConnection(profile.id);
      if (connection) {
        try {
          const eventId = await createGoogleEvent(connection, reminder);
          await service.from("calendar_reminders").update({ google_event_id: eventId, google_calendar_id: connection.calendar_id, sync_status: "synced", sync_error: null, updated_at: new Date().toISOString() }).eq("id", reminder.id).eq("created_by", profile.id);
        } catch (error) {
          await service.from("calendar_reminders").update({ sync_status: "error", sync_error: error instanceof Error ? error.message.slice(0, 500) : "Google sync failed", updated_at: new Date().toISOString() }).eq("id", reminder.id).eq("created_by", profile.id);
          throw new Error("Se guardó en el portal, pero Google Calendar no pudo sincronizarlo.");
        }
      }
    }
  } catch (error) {
    messageRedirect(error instanceof Error ? error.message : "No se pudo crear el evento.", "error");
  }
  revalidatePath("/dashboard");
  revalidatePath("/calendario");
  messageRedirect("Evento creado.");
}

export async function updateReminder(formData: FormData) {
  const profile = await requireAdmin();
  try {
    const id = String(formData.get("id") ?? "");
    if (!UUID.test(id)) throw new Error("El evento no es válido.");
    const input = reminderInput(formData);
    const service = createServiceClient();
    const { data: current, error } = await service.from("calendar_reminders").select("*").eq("id", id).eq("created_by", profile.id).single();
    if (error || !current) throw new Error("El evento no está disponible.");
    const { data: updated, error: updateError } = await service.from("calendar_reminders").update({ ...input, sync_status: "pending", sync_error: null, updated_at: new Date().toISOString() }).eq("id", id).eq("created_by", profile.id).select("*").single();
    if (updateError || !updated) throw new Error("No se pudo actualizar el evento.");
    const connection = await getCalendarConnection(profile.id);
    if (connection) {
      try {
        if (current.google_event_id) {
          await updateGoogleEvent(connection, current.google_event_id, updated, current.google_calendar_id || connection.calendar_id);
          await service.from("calendar_reminders").update({ sync_status: "synced" }).eq("id", id).eq("created_by", profile.id);
        } else {
          const eventId = await createGoogleEvent(connection, updated);
          await service.from("calendar_reminders").update({ google_event_id: eventId, google_calendar_id: connection.calendar_id, sync_status: "synced" }).eq("id", id).eq("created_by", profile.id);
        }
      } catch (syncError) {
        await service.from("calendar_reminders").update({ sync_status: "error", sync_error: syncError instanceof Error ? syncError.message.slice(0, 500) : "Google sync failed" }).eq("id", id).eq("created_by", profile.id);
        throw new Error("Se actualizó en el portal, pero Google Calendar no pudo sincronizarlo.");
      }
    }
  } catch (error) {
    messageRedirect(error instanceof Error ? error.message : "No se pudo actualizar el evento.", "error");
  }
  revalidatePath("/dashboard");
  revalidatePath("/calendario");
  messageRedirect("Evento actualizado.");
}

export async function deleteReminder(formData: FormData) {
  const profile = await requireAdmin();
  try {
    const id = String(formData.get("id") ?? "");
    if (!UUID.test(id)) throw new Error("El evento no es válido.");
    const service = createServiceClient();
    const { data: reminder, error } = await service.from("calendar_reminders").select("google_event_id,google_calendar_id").eq("id", id).eq("created_by", profile.id).single();
    if (error || !reminder) throw new Error("El evento no está disponible.");
    const connection = await getCalendarConnection(profile.id);
    if (connection && reminder.google_event_id) await deleteGoogleEvent(connection, reminder.google_event_id, reminder.google_calendar_id || connection.calendar_id);
    const { error: deleteError } = await service.from("calendar_reminders").delete().eq("id", id).eq("created_by", profile.id);
    if (deleteError) throw new Error("No se pudo eliminar el evento.");
  } catch (error) {
    messageRedirect(error instanceof Error ? error.message : "No se pudo eliminar el evento.", "error");
  }
  revalidatePath("/dashboard");
  revalidatePath("/calendario");
  messageRedirect("Evento eliminado.");
}

export async function selectGoogleCalendar(formData: FormData) {
  const profile = await requireAdmin();
  try {
    const calendarId = String(formData.get("calendarId") ?? "");
    if (!calendarId || calendarId.length > 1024) throw new Error("El calendario no es válido.");
    const connection = await getCalendarConnection(profile.id);
    if (!connection) throw new Error("Conecta Google Calendar primero.");
    const calendars = await listGoogleCalendars(connection);
    if (!calendars.some((calendar) => calendar.id === calendarId)) throw new Error("No tienes permiso de escritura en ese calendario.");
    const { error } = await createServiceClient().from("google_calendar_connections").update({ calendar_id: calendarId, updated_at: new Date().toISOString() }).eq("user_id", profile.id);
    if (error) throw new Error("No se pudo guardar el calendario seleccionado.");
  } catch (error) {
    messageRedirect(error instanceof Error ? error.message : "No se pudo seleccionar el calendario.", "error");
  }
  revalidatePath("/calendario");
  messageRedirect("Calendario seleccionado.");
}

export async function disconnectGoogleCalendar() {
  const profile = await requireAdmin();
  const service = createServiceClient();
  const { error } = await service.from("google_calendar_connections").delete().eq("user_id", profile.id);
  if (error) messageRedirect("No se pudo desconectar Google Calendar.", "error");
  await service.from("calendar_reminders").update({ google_event_id: null, google_calendar_id: null, sync_status: "pending", sync_error: null }).eq("created_by", profile.id);
  revalidatePath("/calendario");
  messageRedirect("Google Calendar desconectado.");
}
