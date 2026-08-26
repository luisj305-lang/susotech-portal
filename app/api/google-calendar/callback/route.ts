import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptToken, googleCalendarConfiguration } from "@/lib/calendar/google";

export const runtime = "nodejs";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error_description?: string;
};

function idTokenClaims(idToken?: string): { email?: string; hd?: string } {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1] || "", "base64url").toString("utf8")) as { email?: string; hd?: string };
  } catch {
    return {};
  }
}

function calendarRedirect(request: Request, kind: "ok" | "error", message: string) {
  const url = new URL("/calendario", request.url);
  url.searchParams.set(kind, message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const profile = await requireAdmin();
  const configuration = googleCalendarConfiguration();
  if (!configuration.configured) return calendarRedirect(request, "error", "Google Calendar no está configurado.");

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("google_calendar_oauth_state")?.value;
  cookieStore.delete("google_calendar_oauth_state");
  if (!state || !expectedState || state !== expectedState || !code) {
    return calendarRedirect(request, "error", "La autorización de Google expiró o no es válida.");
  }

  const origin = url.origin;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${origin}/api/google-calendar/callback`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const token = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || !token.access_token || !token.refresh_token || !token.expires_in) {
    return calendarRedirect(request, "error", token.error_description || "Google no entregó una autorización permanente.");
  }

  const claims = idTokenClaims(token.id_token);
  const expectedDomain = process.env.GOOGLE_WORKSPACE_DOMAIN?.toLowerCase();
  if (expectedDomain && claims.hd?.toLowerCase() !== expectedDomain) {
    return calendarRedirect(request, "error", `Debes autorizar una cuenta de ${expectedDomain}.`);
  }

  const service = createServiceClient();
  const { data: existing } = await service.from("google_calendar_connections").select("calendar_id").eq("user_id", profile.id).maybeSingle();
  const { error } = await service.from("google_calendar_connections").upsert({
    user_id: profile.id,
    google_email: claims.email ?? null,
    calendar_id: existing?.calendar_id || "primary",
    access_token_encrypted: encryptToken(token.access_token),
    refresh_token_encrypted: encryptToken(token.refresh_token),
    access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    scope: token.scope ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return calendarRedirect(request, "error", "No se pudo guardar la conexión de Google Calendar.");
  return calendarRedirect(request, "ok", "Google Calendar conectado.");
}
