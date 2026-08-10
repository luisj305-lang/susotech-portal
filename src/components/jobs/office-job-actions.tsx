"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignJob, transitionJob } from "@/lib/jobs/actions";
import type { AssigneeOption, JobAssignment, JobStatus } from "@/lib/jobs/types";
import { AssigneeSelect } from "./assignee-select";

const nextOfficeStatus: Partial<Record<JobStatus, { status: JobStatus; label: string }>> = {
  enviado_revision: { status: "aprobado", label: "Aprobar trabajo" },
  aprobado: { status: "listo_pagar", label: "Marcar listo para pagar" },
  listo_pagar: { status: "pagado", label: "Marcar como pagado" },
};

export function OfficeJobActions({ jobId, status, assignment, options }: { jobId: string; status: JobStatus; assignment: JobAssignment | null; options: AssigneeOption[] }) {
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
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </section>;
}
