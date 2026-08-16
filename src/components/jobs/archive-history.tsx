import type { ArchiveReasonCode, JobArchiveEvent } from "@/lib/jobs/types";

const reasonLabels: Record<ArchiveReasonCode, string> = {
  duplicate_job: "Trabajo duplicado",
  cancelled_by_client_or_office: "Cancelado por el cliente o la oficina",
  incorrect_address_or_data: "Dirección o datos incorrectos",
  no_access_or_blocked_conditions: "Sin acceso o condiciones que impiden realizarlo",
  out_of_scope: "Fuera de alcance o no corresponde a Susotech",
};

const dateTime = new Intl.DateTimeFormat("es-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

export function ArchiveHistory({ events }: { events: JobArchiveEvent[] }) {
  if (events.length === 0) return null;

  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <h2 className="text-lg font-semibold text-ink">Historial de archivado</h2>
      <ol className="mt-4 grid gap-4 border-l-2 border-line pl-5">
        {events.map((event) => (
          <li key={event.id}>
            <p className="font-medium text-ink">
              {event.event_type === "archived" ? "Trabajo archivado" : "Trabajo restaurado"}
            </p>
            {event.reason_code && <p className="text-sm text-ink-soft">{reasonLabels[event.reason_code]}</p>}
            {event.notes && <p className="text-sm text-ink-soft">{event.notes}</p>}
            <p className="text-sm text-ink-muted">
              {event.actor_name ?? "Usuario no disponible"} · {dateTime.format(new Date(event.occurred_at))}
              {event.is_legacy ? " · Registro anterior" : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
