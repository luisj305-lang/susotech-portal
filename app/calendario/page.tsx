import { AppShell } from "@/components/dashboard/app-shell";
import { RemindersCard, localDateTime, type CalendarReminder } from "@/components/calendar/reminders-card";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSupervisor } from "@/lib/auth/session";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { createClient } from "@/lib/supabase/server";
import { disconnectGoogleCalendar, selectGoogleCalendar, updateReminder } from "@/lib/calendar/actions";
import { getCalendarConnection, googleCalendarConfiguration, listGoogleCalendars } from "@/lib/calendar/google";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireSupervisor();
  const isAdmin = profile.role === "admin";
  const query = await searchParams;
  const configuration = isAdmin ? googleCalendarConfiguration() : null;
  const connection = isAdmin && configuration?.configured ? await getCalendarConnection(profile.id) : null;
  const supabase = await createClient();
  let remindersQuery = supabase.from("calendar_reminders").select("id,title,notes,starts_at,ends_at,sync_status,sync_error").order("starts_at", { ascending: true }).limit(100);
  if (isAdmin) remindersQuery = remindersQuery.eq("created_by", profile.id);
  const { data, error } = await remindersQuery;
  if (error) throw new Error("No se pudieron cargar los eventos.");
  let calendars: Awaited<ReturnType<typeof listGoogleCalendars>> = [];
  let calendarLoadError: string | null = null;
  if (isAdmin && connection) {
    try { calendars = await listGoogleCalendars(connection); } catch { calendarLoadError = "No se pudo consultar la lista de calendarios."; }
  }
  const ok = Array.isArray(query.ok) ? query.ok[0] : query.ok;
  const messageError = Array.isArray(query.error) ? query.error[0] : query.error;

  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div><h1 className="text-3xl font-bold text-ink">Calendario</h1><p className="mt-2 text-ink-muted">{isAdmin ? "Los eventos creados o modificados en el portal se envían al calendario seleccionado de Google." : "Consulta los eventos registrados por administración. Esta vista es de solo lectura."}</p></div>
        {ok ? <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</p> : null}
        {messageError ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{messageError}</p> : null}
        {isAdmin ? <Card>
          <CardHeader><CardTitle>Conexión con Google Calendar</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!configuration?.configured ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">La integración aún no está configurada.</p>
                <p>Configura en el servidor: {configuration?.missing.join(", ")}. Opcionales: GOOGLE_CALENDAR_REDIRECT_URI y GOOGLE_WORKSPACE_DOMAIN.</p>
              </div>
            ) : connection ? (
              <>
                <p className="text-sm text-ink-muted">Conectado como <strong>{connection.google_email || "cuenta de Google"}</strong>.</p>
                {calendarLoadError ? <p className="text-sm text-red-700">{calendarLoadError}</p> : (
                  <form action={selectGoogleCalendar} className="flex flex-wrap items-end gap-3">
                    <label className="grid min-w-64 flex-1 gap-1 text-sm font-medium">Calendario<select name="calendarId" defaultValue={connection.calendar_id} className="rounded-md border border-line px-3 py-2">{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " (principal)" : ""}</option>)}</select></label>
                    <button className={buttonClasses({ variant: "secondary" })}>Guardar selección</button>
                  </form>
                )}
                <form action={disconnectGoogleCalendar}><button className={buttonClasses({ variant: "danger", size: "sm" })}>Desconectar</button></form>
              </>
            ) : <a className={buttonClasses()} href="/api/google-calendar/connect">Conectar Google Calendar</a>}
          </CardContent>
        </Card> : null}
        <RemindersCard reminders={(data ?? []) as CalendarReminder[]} connected={Boolean(connection)} readOnly={!isAdmin} />
        {isAdmin && (data ?? []).length ? <Card><CardHeader><CardTitle>Editar eventos</CardTitle></CardHeader><CardContent className="space-y-5">{((data ?? []) as CalendarReminder[]).map((reminder) => <form action={updateReminder} className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2" key={reminder.id}><input type="hidden" name="id" value={reminder.id} /><label className="grid gap-1 text-sm font-medium">Título<input name="title" maxLength={160} required defaultValue={reminder.title} className="rounded-md border border-line px-3 py-2" /></label><label className="grid gap-1 text-sm font-medium">Notas<input name="notes" maxLength={4000} defaultValue={reminder.notes ?? ""} className="rounded-md border border-line px-3 py-2" /></label><label className="grid gap-1 text-sm font-medium">Inicio<input name="startsAt" type="datetime-local" required defaultValue={localDateTime(reminder.starts_at)} className="rounded-md border border-line px-3 py-2" /></label><label className="grid gap-1 text-sm font-medium">Fin<input name="endsAt" type="datetime-local" required defaultValue={localDateTime(reminder.ends_at)} className="rounded-md border border-line px-3 py-2" /></label><button className={buttonClasses({ size: "sm" })}>Guardar cambios</button></form>)}</CardContent></Card> : null}
      </main>
    </AppShell>
  );
}
