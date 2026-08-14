"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setIncident, transitionJob } from "@/lib/jobs/actions";
import type { IncidentType, JobStatus } from "@/lib/jobs/types";

const next: Partial<Record<JobStatus, { status: JobStatus; label: string }>> = { asignado: { status: "en_progreso", label: "Iniciar trabajo" } };

export function TechnicianActions({ jobId, status, incident }: { jobId: string; status: JobStatus; incident: IncidentType | null }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const advance = next[status];
  const run = (action: () => Promise<{ success: boolean; message: string }>) => startTransition(async () => { const result = await action(); setMessage(result.message); if (result.success) router.refresh(); });
  const deliver = () => startTransition(() => router.push(`/trabajos/${jobId}/entregar`));

  return <section className="grid gap-4 rounded-2xl bg-white p-5 text-black shadow-lg"><h2 className="text-xl font-bold">Acciones</h2>{advance && <button type="button" disabled={pending} onClick={() => run(() => transitionJob({ jobId, newStatus: advance.status }))} className="min-h-14 rounded-xl bg-black px-5 text-lg font-bold text-white disabled:opacity-60">{advance.label}</button>}{status === "en_progreso" && <button type="button" disabled={pending} onClick={deliver} className="min-h-14 rounded-xl bg-black px-5 text-lg font-bold text-white disabled:opacity-60">Entregar trabajo</button>}
    <form action={(data) => run(() => setIncident({ jobId, incident: (String(data.get("incident")) || null) as IncidentType | null, notes: String(data.get("notes") ?? "") }))} className="grid gap-3"><label className="grid gap-1 font-semibold">Incidencia<select name="incident" defaultValue={incident ?? ""} className="min-h-12 rounded-xl border p-3"><option value="">Sin incidencia / resolver</option><option value="need_splicing">Requiere empalme</option><option value="no_access">Sin acceso</option><option value="need_cr">Requiere CR</option><option value="permit_pending">Permiso pendiente</option><option value="returned">Devuelto</option><option value="incomplete">Incompleto</option></select></label><label className="grid gap-1 font-semibold">Notas<input name="notes" className="min-h-12 rounded-xl border p-3" /></label><button disabled={pending} className="min-h-14 rounded-xl bg-black px-5 text-lg font-bold text-white disabled:opacity-60">Guardar incidencia</button></form><p role="status" aria-live="polite">{message}</p>
  </section>;
}
