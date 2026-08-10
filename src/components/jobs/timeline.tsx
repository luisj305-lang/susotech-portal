import type { JobStatusHistoryEntry } from "@/lib/jobs/types";

const labels: Record<string, string> = { asignado: "Asignado", en_progreso: "En progreso", enviado_revision: "En revisión", aprobado: "Aprobado", listo_pagar: "Listo para pagar", pagado: "Pagado" };
const incidents: Record<string, string> = { need_splicing: "Requiere empalme", no_access: "Sin acceso", need_cr: "Requiere CR", permit_pending: "Permiso pendiente", returned: "Devuelto", incomplete: "Incompleto" };

export function Timeline({ entries }: { entries: JobStatusHistoryEntry[] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Historial</h2>{entries.length ? <ol className="mt-4 grid gap-4 border-l-2 border-slate-200 pl-5">{entries.map((entry) => <li key={entry.id}><p className="font-medium">{entry.previous_status !== entry.new_status ? `${labels[entry.previous_status ?? ""] ?? "Sin estado"} → ${labels[entry.new_status ?? ""] ?? "Sin estado"}` : `Incidencia: ${incidents[entry.new_incident ?? ""] ?? "resuelta"}`}</p><p className="text-sm text-slate-600">{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at))}</p>{entry.notes && <p className="text-sm">{entry.notes}</p>}</li>)}</ol> : <p className="mt-3 text-slate-600">Todavía no hay cambios registrados.</p>}</section>;
}
