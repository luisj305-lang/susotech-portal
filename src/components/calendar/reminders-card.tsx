import Link from "next/link";
import { createReminder, deleteReminder } from "@/lib/calendar/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";

export type CalendarReminder = {
  id: string;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  sync_status: "pending" | "synced" | "error";
  sync_error: string | null;
};

export function localDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function RemindersCard({
  reminders,
  connected,
  compact = false,
  readOnly = false,
}: {
  reminders: CalendarReminder[];
  connected: boolean;
  compact?: boolean;
  readOnly?: boolean;
}) {
  const now = new Date();
  const starts = new Date(now.getTime() + 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 30 * 60 * 1000);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Próximos eventos</CardTitle>
          <p className="mt-1 text-sm text-ink-muted">
            {readOnly
              ? "Vista de solo lectura; el administrador gestiona los eventos."
              : connected
                ? "Sincronizados con Google Calendar"
                : "Conecta Google Calendar para sincronizarlos"}
          </p>
        </div>
        {readOnly && !compact ? (
          <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-muted">Solo lectura</span>
        ) : (
          <Link className={buttonClasses({ variant: "secondary", size: "sm" })} href="/calendario">{readOnly ? "Ver calendario" : "Administrar"}</Link>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!compact && !readOnly ? (
          <form action={createReminder} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <label className="grid gap-1 text-sm font-medium">Título<input required maxLength={160} name="title" className="rounded-md border border-line px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-medium">Notas<input maxLength={4000} name="notes" className="rounded-md border border-line px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-medium">Inicio<input required type="datetime-local" name="startsAt" defaultValue={localDateTime(starts.toISOString())} className="rounded-md border border-line px-3 py-2" /></label>
            <label className="grid gap-1 text-sm font-medium">Fin<input required type="datetime-local" name="endsAt" defaultValue={localDateTime(ends.toISOString())} className="rounded-md border border-line px-3 py-2" /></label>
            <button className={buttonClasses({ size: "sm" })} type="submit">Crear evento</button>
          </form>
        ) : null}
        {reminders.length === 0 ? <p className="text-sm text-ink-muted">No hay eventos próximos.</p> : (
          <ul className="divide-y divide-line">
            {reminders.map((reminder) => (
              <li className="flex items-start justify-between gap-3 py-3" key={reminder.id}>
                <div>
                  <p className="font-semibold text-ink">{reminder.title}</p>
                  <p className="text-sm text-ink-muted">{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(reminder.starts_at))}</p>
                  {reminder.sync_status === "error" ? <p className="text-xs text-red-700">Pendiente de sincronización</p> : null}
                </div>
                {!compact && !readOnly ? <form action={deleteReminder}><input type="hidden" name="id" value={reminder.id} /><button type="submit" className={buttonClasses({ variant: "danger", size: "sm" })}>Eliminar</button></form> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
