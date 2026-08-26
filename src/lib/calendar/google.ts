import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type CalendarConnection = {
  user_id: string;
  google_email: string | null;
  calendar_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  access_token_expires_at: string;
  scope: string | null;
};

export type GoogleCalendarChoice = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
};

export function googleCalendarConfiguration() {
  const missing = [
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
  ].filter((name) => !process.env[name]);
  return { configured: missing.length === 0, missing };
}

function encryptionKey(): Buffer {
  const encoded = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Google Calendar token encryption is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptToken(value: string): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted token.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function parseGoogleError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  if (typeof body?.error === "string") return body.error;
  return body?.error?.message || `Google Calendar request failed (${response.status}).`;
}

export async function getCalendarConnection(userId: string): Promise<CalendarConnection | null> {
  const { data, error } = await createServiceClient()
    .from("google_calendar_connections")
    .select("user_id, google_email, calendar_id, access_token_encrypted, refresh_token_encrypted, access_token_expires_at, scope")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load the Google Calendar connection.");
  return data as CalendarConnection | null;
}

async function accessToken(connection: CalendarConnection): Promise<string> {
  if (new Date(connection.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return decryptToken(connection.access_token_encrypted);
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: decryptToken(connection.refresh_token_encrypted),
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await parseGoogleError(response));
  const token = (await response.json()) as { access_token: string; expires_in: number; scope?: string };
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const encrypted = encryptToken(token.access_token);
  const { error } = await createServiceClient()
    .from("google_calendar_connections")
    .update({
      access_token_encrypted: encrypted,
      access_token_expires_at: expiresAt,
      scope: token.scope ?? connection.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", connection.user_id);
  if (error) throw new Error("Could not persist the refreshed Google access token.");
  return token.access_token;
}

async function googleRequest(connection: CalendarConnection, path: string, init?: RequestInit): Promise<Response> {
  const token = await accessToken(connection);
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await parseGoogleError(response));
  return response;
}

export async function listGoogleCalendars(connection: CalendarConnection): Promise<GoogleCalendarChoice[]> {
  const response = await googleRequest(connection, "/users/me/calendarList?minAccessRole=writer&maxResults=250");
  const data = (await response.json()) as { items?: GoogleCalendarChoice[] };
  return (data.items ?? []).filter((calendar) => calendar.id && calendar.summary);
}

type ReminderEvent = { id: string; title: string; notes: string | null; starts_at: string; ends_at: string };

function eventBody(reminder: ReminderEvent, googleEventId?: string) {
  return JSON.stringify({
    ...(googleEventId ? { id: googleEventId } : {}),
    summary: reminder.title,
    description: reminder.notes || undefined,
    start: { dateTime: reminder.starts_at, timeZone: "America/New_York" },
    end: { dateTime: reminder.ends_at, timeZone: "America/New_York" },
    extendedProperties: { private: { portalReminderId: reminder.id } },
  });
}

export async function createGoogleEvent(connection: CalendarConnection, reminder: ReminderEvent): Promise<string> {
  const calendarId = encodeURIComponent(connection.calendar_id);
  const googleEventId = reminder.id.replaceAll("-", "").toLowerCase();
  const token = await accessToken(connection);
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${calendarId}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: eventBody(reminder, googleEventId),
    cache: "no-store",
  });
  if (response.status === 409) return googleEventId;
  if (!response.ok) throw new Error(await parseGoogleError(response));
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error("Google Calendar did not return an event ID.");
  return data.id;
}

export async function updateGoogleEvent(connection: CalendarConnection, googleEventId: string, reminder: ReminderEvent, calendarId = connection.calendar_id): Promise<void> {
  await googleRequest(connection, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`, {
    method: "PATCH",
    body: eventBody(reminder),
  });
}

export async function deleteGoogleEvent(connection: CalendarConnection, googleEventId: string, calendarId = connection.calendar_id): Promise<void> {
  const token = await accessToken(connection);
  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(await parseGoogleError(response));
  }
}
