import type { JobStatusHistoryEntry } from "@/lib/jobs/types";

const labels: Record<string, string> = { sin_asignar: "Sin asignar", asignado: "Asignado", en_revision: "En revisión", aprobado: "Aprobado", facturado: "Facturado", pagado: "Pagado" };
const incidents: Record<string, string> = { need_splicing: "Requiere empalme", no_access: "Sin acceso", need_cr: "Requiere CR", permit_pending: "Permiso pendiente", returned: "Devuelto", incomplete: "Incompleto" };

export function Timeline({ entries }: { entries: JobStatusHistoryEntry[] }) {
  return <section className="rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-lg font-semibold text-ink">Historial</h2>{entries.length ? <ol className="mt-4 grid gap-4 border-l-2 border-line pl-5">{entries.map((entry) => <li key={entry.id}><p className="font-medium text-ink">{entry.previous_status !== entry.new_status ? `${labels[entry.previous_status ?? ""] ?? "Sin estado"} → ${labels[entry.new_status ?? ""] ?? "Sin estado"}` : `Incidencia: ${incidents[entry.new_incident ?? ""] ?? "resuelta"}`}</p><p className="text-sm text-ink-muted">{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at))}</p>{entry.notes && <p className="text-sm text-ink-soft">{entry.notes}</p>}</li>)}</ol> : <p className="mt-3 text-ink-soft">Todavía no hay cambios registrados.</p>}</section>;
}
