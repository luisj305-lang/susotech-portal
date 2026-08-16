"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transitionJob } from "@/lib/jobs/actions";
import type { JobStatus } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { IconChevronRight } from "@/components/ui/icons";

const next: Partial<Record<JobStatus, { status: JobStatus; label: string }>> = { asignado: { status: "en_progreso", label: "Iniciar trabajo" } };

export function TechnicianActions({ jobId, status }: { jobId: string; status: JobStatus }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const advance = next[status];
  const deliverable = ["en_progreso", "enviado_revision"].includes(status);
  const run = (action: () => Promise<{ success: boolean; message: string }>) => startTransition(async () => { const result = await action(); setMessage(result.message); if (result.success) router.refresh(); });
  const deliver = () => startTransition(() => router.push(`/trabajos/${jobId}/entregar`));

  const reason = status === "asignado"
    ? "Inicia el trabajo para habilitar la entrega."
    : ["aprobado", "listo_pagar", "pagado"].includes(status)
      ? "Este trabajo ya fue aprobado."
      : "Este trabajo no permite la entrega en su estado actual.";

  return (
    <section className="grid gap-4 rounded-2xl border border-line bg-white p-6 text-ink shadow-card">
      <h2 className="text-xl font-bold text-ink">Acciones</h2>
      {advance && <Button variant="secondary" size="lg" type="button" disabled={pending} onClick={() => run(() => transitionJob({ jobId, newStatus: advance.status }))} className="w-full">{advance.label}</Button>}
      <Button variant="primary" size="lg" type="button" disabled={pending || !deliverable} onClick={deliver} className="w-full">
        Abrir o continuar la entrega <IconChevronRight className="h-5 w-5" />
      </Button>
      {!deliverable && <p className="text-sm text-ink-muted">{reason}</p>}
      <Alert variant="info">Al continuar, podrás editar el PDF, agregar códigos, cantidades y flechas, y generar el PDF final.</Alert>
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p>
    </section>
  );
}
