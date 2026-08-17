"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobStatus } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { IconChevronRight } from "@/components/ui/icons";

export function TechnicianActions({ jobId, status }: { jobId: string; status: JobStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const deliverable = ["asignado", "en_revision"].includes(status);
  const deliver = () => startTransition(() => router.push(`/trabajos/${jobId}/entregar`));

  const reason = status === "sin_asignar"
    ? "Este trabajo todavía no fue asignado."
    : ["aprobado", "facturado", "pagado"].includes(status)
      ? "Este trabajo ya fue aprobado."
      : "Este trabajo no permite la entrega en su estado actual.";

  return (
    <section className="grid gap-4 rounded-2xl border border-line bg-white p-6 text-ink shadow-card">
      <h2 className="text-xl font-bold text-ink">Acciones</h2>
      <Button variant="primary" size="lg" type="button" disabled={pending || !deliverable} onClick={deliver} className="w-full">
        Abrir o continuar la entrega <IconChevronRight className="h-5 w-5" />
      </Button>
      {!deliverable && <p className="text-sm text-ink-muted">{reason}</p>}
      <Alert variant="info">Al continuar, podrás editar el PDF, agregar códigos, cantidades y flechas, y generar el PDF final.</Alert>
    </section>
  );
}
