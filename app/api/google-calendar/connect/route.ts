import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { googleCalendarConfiguration } from "@/lib/calendar/google";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireAdmin();
  const configuration = googleCalendarConfiguration();
  if (!configuration.configured) {
    return NextResponse.redirect(new URL("/calendario?error=Google+Calendar+no+est%C3%A1+configurado", request.url));
  }

  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("google_calendar_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google-calendar/callback",
    maxAge: 10 * 60,
  });

  const origin = new URL(request.url).origin;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${origin}/api/google-calendar/callback`;
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ].join(" "),
    state,
    ...(process.env.GOOGLE_WORKSPACE_DOMAIN ? { hd: process.env.GOOGLE_WORKSPACE_DOMAIN } : {}),
  }).toString();
  return NextResponse.redirect(authorization);
}

