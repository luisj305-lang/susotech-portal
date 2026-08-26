"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  completeJobStage,
  correctJobStageInvoice,
  createJobStage,
  invoiceJobStage,
  payJobStage,
} from "@/lib/jobs/stage-actions";
import type { JobStage, JobStageEvent, JobStageStatus } from "@/lib/jobs/types";
import { createInvoiceUploadUrl, createSignedDownloadUrl } from "@/lib/storage/actions";
import { supabase } from "@/lib/supabase/client";

const statusLabels: Record<JobStageStatus, string> = {
  pending: "Pendiente",
  completed: "Completada",
  invoiced: "Facturada",
  paid: "Pagada",
};

const statusClasses: Record<JobStageStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-blue-200 bg-blue-50 text-blue-700",
  invoiced: "border-violet-200 bg-violet-50 text-violet-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const eventLabels: Record<JobStageEvent["action"], string> = {
  created: "Etapa creada",
  status_changed: "Estado actualizado",
  invoice_updated: "Factura corregida",
  details_updated: "Datos actualizados",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function JobStagesManager({
  jobId,
  archived,
  stages,
  events,
}: {
  jobId: string;
  archived: boolean;
  stages: JobStage[];
  events: JobStageEvent[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [invoiceTarget, setInvoiceTarget] = useState<string | null>(null);
  const [invoiceValue, setInvoiceValue] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  const run = (operation: () => Promise<{ success: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await operation();
      setMessage(result.message);
      if (result.success) router.refresh();
    });

  const addStage = () => run(async () => {
    const result = await createJobStage({ jobId, title, description });
    if (result.success) {
      setTitle("");
      setDescription("");
    }
    return result;
  });

  const openInvoiceEditor = (stage: JobStage) => {
    setInvoiceTarget(stage.id);
    setInvoiceValue(stage.invoice_number ?? "");
    setInvoiceFile(null);
    setMessage("");
  };

  const submitInvoice = (stage: JobStage) => startTransition(async () => {
    const invoiceNumber = invoiceValue.trim();
    if (!invoiceNumber) {
      setMessage("El número de factura es obligatorio.");
      return;
    }
    let invoicePath: string | null | undefined;
    if (invoiceFile) {
      const prepared = await createInvoiceUploadUrl({
        jobId,
        fileName: invoiceFile.name,
        mimeType: invoiceFile.type,
        size: invoiceFile.size,
      });
      if (!prepared.success) {
        setMessage(prepared.message);
        return;
      }
      const uploaded = await supabase.storage.from("project-files").uploadToSignedUrl(
        prepared.data.path,
        prepared.data.token,
        invoiceFile,
        { contentType: invoiceFile.type },
      );
      if (uploaded.error) {
        setMessage("No se pudo subir el archivo de factura.");
        return;
      }
      invoicePath = prepared.data.path;
    }
    const result = stage.status === "completed"
      ? await invoiceJobStage({ jobId, stageId: stage.id, invoiceNumber, invoicePath })
      : await correctJobStageInvoice({ jobId, stageId: stage.id, invoiceNumber, invoicePath });
    setMessage(result.message);
    if (result.success) {
      setInvoiceTarget(null);
      setInvoiceFile(null);
      router.refresh();
    }
  });

  const openInvoiceFile = (stage: JobStage) => startTransition(async () => {
    const preview = window.open("about:blank", "_blank");
    if (!preview) {
      setMessage("El navegador bloqueó la ventana. Permite ventanas emergentes e inténtalo de nuevo.");
      return;
    }
    preview.opener = null;
    if (!stage.invoice_path) {
      preview.close();
      setMessage("La etapa no tiene un documento de factura adjunto.");
      return;
    }
    const result = await createSignedDownloadUrl({ bucket: "project-files", path: stage.invoice_path });
    setMessage(result.message);
    if (result.success) preview.location.replace(result.data.signedUrl);
    else preview.close();
  });

  return (
    <section className="grid gap-5 rounded-2xl border border-line bg-white p-6 shadow-card">
      <div>
        <h2 className="text-lg font-semibold text-ink">Etapas facturables</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Cada etapa conserva su propio estado y factura. Completar o pagar una etapa no cierra el trabajo.
        </p>
      </div>

      {!archived && (
        <div className="grid gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Nombre de la etapa
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={pending} placeholder="Ej. Instalación norte" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Descripción (opcional)
            <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} disabled={pending} placeholder="Alcance de esta entrega" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
          </label>
          <Button type="button" disabled={pending || !title.trim()} onClick={addStage} className="w-fit sm:col-span-2">
            {pending ? "Guardando…" : "Agregar etapa"}
          </Button>
        </div>
      )}

      {stages.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-soft">Este trabajo todavía no tiene etapas facturables.</p>
      ) : (
        <div className="grid gap-3">
          {stages.map((stage) => {
            const stageEvents = events.filter((event) => event.stage_id === stage.id);
            return (
              <article key={stage.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Etapa {stage.sequence}</p>
                    <h3 className="font-semibold text-ink">{stage.title}</h3>
                    {stage.description && <p className="mt-1 text-sm text-ink-soft">{stage.description}</p>}
                    {stage.invoice_number && <p className="mt-1 text-sm text-ink">Factura: <strong>{stage.invoice_number}</strong></p>}
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses[stage.status]}`}>{statusLabels[stage.status]}</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!archived && stage.status === "pending" && <Button type="button" size="sm" disabled={pending} onClick={() => run(() => completeJobStage({ jobId, stageId: stage.id }))}>Marcar completada</Button>}
                  {!archived && stage.status === "completed" && <Button type="button" size="sm" disabled={pending} onClick={() => openInvoiceEditor(stage)}>Facturar etapa</Button>}
                  {!archived && stage.status === "invoiced" && <Button type="button" size="sm" disabled={pending} onClick={() => run(() => payJobStage({ jobId, stageId: stage.id }))}>Marcar pagada</Button>}
                  {!archived && stage.status === "invoiced" && <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => openInvoiceEditor(stage)}>Corregir factura</Button>}
                  {stage.invoice_path && <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => openInvoiceFile(stage)}>Ver factura</Button>}
                </div>

                {invoiceTarget === stage.id && (
                  <div className="mt-3 grid gap-3 rounded-xl border border-line bg-surface-muted p-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-medium text-ink-soft">Número de factura<input value={invoiceValue} onChange={(event) => setInvoiceValue(event.target.value)} maxLength={200} disabled={pending} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
                    <label className="grid gap-1 text-sm font-medium text-ink-soft">Documento (opcional)<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={pending} onChange={(event) => setInvoiceFile(event.target.files?.[0] ?? null)} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink" /></label>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="button" size="sm" disabled={pending} onClick={() => submitInvoice(stage)}>{pending ? "Guardando…" : "Guardar factura"}</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setInvoiceTarget(null)}>Cancelar</Button>
                    </div>
                  </div>
                )}

                <details className="mt-3 border-t border-line pt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-ink-soft">Auditoría ({stageEvents.length})</summary>
                  <ul className="mt-2 grid gap-1 text-xs text-ink-muted">
                    {stageEvents.map((event) => (
                      <li key={event.id}>{formatDate(event.created_at)} · {eventLabels[event.action]}{event.previous_status && event.new_status ? ` (${statusLabels[event.previous_status]} → ${statusLabels[event.new_status]})` : ""}</li>
                    ))}
                  </ul>
                </details>
              </article>
            );
          })}
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p>
    </section>
  );
}
