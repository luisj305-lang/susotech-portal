"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignJob, setJobArchived, transitionJob } from "@/lib/jobs/actions";
import type { AssigneeOption, JobAssignment, JobStatus } from "@/lib/jobs/types";
import { AssigneeSelect } from "./assignee-select";

const nextOfficeStatus: Partial<Record<JobStatus, { status: JobStatus; label: string }>> = {
  enviado_revision: { status: "aprobado", label: "Aprobar trabajo" },
  aprobado: { status: "listo_pagar", label: "Marcar listo para pagar" },
  listo_pagar: { status: "pagado", label: "Marcar como pagado" },
};

export function OfficeJobActions({ jobId, status, assignment, options, canArchive, archived }: { jobId: string; status: JobStatus; assignment: JobAssignment | null; options: AssigneeOption[]; canArchive?: boolean; archived?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const next = nextOfficeStatus[status];
  const current = assignment ? `${assignment.assignee_type}:${assignment.technician_id ?? assignment.crew_id}` : "";
  const run = (operation: () => Promise<{ success: boolean; message: string }>) => startTransition(async () => { const result = await operation(); setMessage(result.message); if (result.success) router.refresh(); });

  return <section className="grid gap-4 rounded-2xl border border-white bg-black p-5 shadow-sm">
    <h2 className="text-lg font-semibold">Asignación y estado</h2>
    <form action={(data) => { const [assigneeType, assigneeId] = String(data.get("assignee")).split(":"); void run(() => assignJob({ jobId, assigneeType: assigneeType as "technician" | "crew", assigneeId })); }} className="flex flex-col gap-3 sm:flex-row">
      <label className="grid flex-1 gap-1 text-sm font-medium">Asignar a<AssigneeSelect name="assignee" options={options} defaultValue={current} required /></label>
      <button disabled={pending || !options.length} className="self-end rounded-lg border border-white px-5 py-3 font-semibold disabled:opacity-60">Guardar asignación</button>
    </form>
    {next && <button type="button" disabled={pending} onClick={() => run(() => transitionJob({ jobId, newStatus: next.status }))} className="w-fit rounded-lg bg-black px-5 py-3 font-semibold text-white disabled:opacity-60">{next.label}</button>}
    {status === "enviado_revision" && <form action={(data) => void run(() => transitionJob({ jobId, newStatus: "en_progreso", reason: String(data.get("reason") ?? "") }))} className="flex flex-col gap-3 sm:flex-row"><label className="grid flex-1 gap-1 text-sm font-medium">Motivo de devolución<input name="reason" required className="rounded-lg border p-3" /></label><button disabled={pending} className="self-end rounded-lg border px-5 py-3 font-semibold">Devolver a corrección</button></form>}
    {canArchive && (archived ? <button type="button" disabled={pending} onClick={() => run(() => setJobArchived({ jobId, archived: false }))} className="w-fit rounded-lg border border-white px-5 py-3 font-semibold disabled:opacity-60">Restaurar trabajo</button> : <form action={(data) => void run(() => setJobArchived({ jobId, archived: true, reasonCode: String(data.get("archiveReasonCode") ?? ""), notes: String(data.get("archiveNotes") ?? "") }))} className="grid gap-3 border-t border-white pt-4"><label className="grid gap-1 text-sm font-medium">Motivo para retirar del dashboard<select name="archiveReasonCode" required defaultValue="" className="rounded-lg border border-white bg-black p-3 text-white"><option value="" disabled>Selecciona un motivo</option><option value="duplicate_job">Trabajo duplicado</option><option value="cancelled_by_client_or_office">Cancelado por el cliente o la oficina</option><option value="incorrect_address_or_data">Dirección o datos incorrectos</option><option value="no_access_or_blocked_conditions">Sin acceso o condiciones que impiden realizarlo</option><option value="out_of_scope">Fuera de alcance o no corresponde a Susotech</option></select></label><label className="grid gap-1 text-sm font-medium">Observaciones (opcional)<textarea name="archiveNotes" maxLength={2000} rows={3} className="rounded-lg border border-white bg-black p-3 text-white" /></label><button disabled={pending} className="w-fit rounded-lg border border-white px-5 py-3 font-semibold disabled:opacity-60">Archivar trabajo</button></form>)}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </section>;
}
