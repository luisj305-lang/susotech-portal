"use client";

import { useState } from "react";
import type { IncidentType, JobStatusHistoryEntry } from "@/lib/jobs/types";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const statusLabels: Record<string, string> = {
  sin_asignar: "Sin asignar",
  asignado: "Asignado",
  en_progreso: "En progreso",
  enviado_revision: "En revisión",
  aprobado: "Aprobado",
  listo_pagar: "Listo para pagar",
  pagado: "Pagado",
};

const incidentLabels: Record<IncidentType, string> = {
  need_splicing: "Requiere empalme",
  no_access: "Sin acceso",
  need_cr: "Requiere CR",
  permit_pending: "Permiso pendiente",
  returned: "Devuelto",
  incomplete: "Incompleto",
};

const formatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
});

function transitionLabel(entry: JobStatusHistoryEntry): string {
  if (entry.previous_status === entry.new_status) {
    const incident = entry.new_incident ?? entry.previous_incident;
    if (incident) return `Incidencia: ${incidentLabels[incident]}`;
    return "Sin cambios";
  }
  const from = entry.previous_status ? statusLabels[entry.previous_status] ?? entry.previous_status : "Sin asignar";
  const to = entry.new_status ? statusLabels[entry.new_status] ?? entry.new_status : "Sin asignar";
  return `${from} → ${to}`;
}

export function CollapsibleTimeline({
  entries,
}: {
  entries: JobStatusHistoryEntry[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <section id="historial" className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">Historial</h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={buttonClasses({ variant: "secondary", size: "md" })}
          aria-expanded={open}
        >
          Ver historial
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {open ? (
        entries.length ? (
          <ol className="mt-4 space-y-4 border-l-2 border-line pl-5">
            {entries.map((entry) => (
              <li key={entry.id} className="relative">
                <span
                  className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-brand-900"
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold text-ink">{transitionLabel(entry)}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {formatter.format(new Date(entry.created_at))}
                </p>
                {entry.notes ? (
                  <p className="mt-1 text-sm text-ink-soft">{entry.notes}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">
            Todavía no hay cambios registrados.
          </p>
        )
      ) : null}
    </section>
  );
}
