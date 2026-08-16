"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignJob, setJobArchived, transitionJob, unassignJob } from "@/lib/jobs/actions";
import type { AssigneeOption, JobAssignment, JobStatus } from "@/lib/jobs/types";
import { AssigneeSelect } from "./assignee-select";
import { Button } from "@/components/ui/button";

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
  const current = assignment?.assignee_type === "technician" ? `technician:${assignment.technician_id}` : "";
  const run = (operation: () => Promise<{ success: boolean; message: string }>) => startTransition(async () => { const result = await operation(); setMessage(result.message); if (result.success) router.refresh(); });

  return <section className="grid gap-4 rounded-2xl border border-line bg-white p-6 shadow-card">
    <h2 className="text-lg font-semibold text-ink">Asignación y estado</h2>
    {assignment?.assignee_type === "crew" && <p className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-ink">Este trabajo conserva una asignación histórica por crew. Selecciona un responsable individual para reemplazarla.</p>}
    <form action={(data) => { const [, assigneeId] = String(data.get("assignee")).split(":"); void run(() => assignJob({ jobId, assigneeType: "technician", assigneeId })); }} className="flex flex-col gap-3 sm:flex-row">
      <label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Asignar a<AssigneeSelect name="assignee" options={options} defaultValue={current} required /></label>
      <Button disabled={pending || !options.length} className="self-end" variant="secondary">Guardar asignación</Button>
      {assignment && status === "asignado" && <Button type="button" disabled={pending} onClick={() => run(() => unassignJob({ jobId }))} className="self-end" variant="secondary">Quitar asignación</Button>}
    </form>
    {next && <Button type="button" disabled={pending} onClick={() => run(() => transitionJob({ jobId, newStatus: next.status }))} className="w-fit" variant="primary">{next.label}</Button>}
    {status === "enviado_revision" && <form action={(data) => void run(() => transitionJob({ jobId, newStatus: "en_progreso", reason: String(data.get("reason") ?? "") }))} className="flex flex-col gap-3 sm:flex-row"><label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Motivo de devolución<input name="reason" required className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><Button disabled={pending} className="self-end" variant="secondary">Devolver a corrección</Button></form>}
    {canArchive && (archived ? <Button type="button" disabled={pending} onClick={() => run(() => setJobArchived({ jobId, archived: false }))} className="w-fit" variant="secondary">Restaurar trabajo</Button> : <form action={(data) => void run(() => setJobArchived({ jobId, archived: true, reasonCode: String(data.get("archiveReasonCode") ?? ""), notes: String(data.get("archiveNotes") ?? "") }))} className="grid gap-3 border-t border-line pt-4"><label className="grid gap-1 text-sm font-medium text-ink-soft">Motivo para retirar del dashboard<select name="archiveReasonCode" required defaultValue="" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="" disabled>Selecciona un motivo</option><option value="duplicate_job">Trabajo duplicado</option><option value="cancelled_by_client_or_office">Cancelado por el cliente o la oficina</option><option value="incorrect_address_or_data">Dirección o datos incorrectos</option><option value="no_access_or_blocked_conditions">Sin acceso o condiciones que impiden realizarlo</option><option value="out_of_scope">Fuera de alcance o no corresponde a Susotech</option></select></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Observaciones (opcional)<textarea name="archiveNotes" maxLength={2000} rows={3} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><Button disabled={pending} className="w-fit" variant="secondary">Archivar trabajo</Button></form>)}
    <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p>
  </section>;
}
