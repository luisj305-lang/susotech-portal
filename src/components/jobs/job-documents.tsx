"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSignedDownloadUrl, deleteJobPdf } from "@/lib/storage/actions";
import type { DeliveredPdfStatus, JobStatus } from "@/lib/jobs/types";

const statusCopy: Record<DeliveredPdfStatus, string> = {
  pending: "Pendiente",
  current: "Vigente",
  stale: "Desactualizado",
};

export function JobDocuments({
  jobId,
  originalPath,
  deliveredPath,
  deliveredStatus,
  jobStatus,
  canRegenerate = false,
  canDelete = false,
}: {
  jobId: string;
  originalPath: string | null;
  deliveredPath: string | null;
  deliveredStatus: DeliveredPdfStatus;
  jobStatus: JobStatus;
  canRegenerate?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const open = (path: string) => {
    const preview = window.open("about:blank", "_blank");
    if (!preview) {
      setMessage("El navegador bloqueó la ventana del PDF. Permite ventanas emergentes e inténtalo de nuevo.");
      return;
    }
    preview.opener = null;
    startTransition(async () => {
      try {
        const result = await createSignedDownloadUrl({ bucket: "project-files", path });
        setMessage(result.message);
        if (result.success) {
          preview.location.replace(result.data.signedUrl);
          return;
        }
      } catch {
        setMessage("No se pudo abrir el PDF.");
      }
      preview.close();
    });
  };
  const regenerate = () => startTransition(async () => {
    const response = await fetch(`/api/trabajos/${jobId}/pdf-entregado`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submit: false }),
    });
    const result = await response.json().catch(() => ({ message: "No se pudo generar el PDF entregado." }));
    setMessage(result.message || "No se pudo generar el PDF entregado.");
    if (response.ok) router.refresh();
  });
  const remove = (documentKind: "original" | "delivered") => {
    const label = documentKind === "original" ? "PDF original" : "PDF entregado";
    if (!window.confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;
    startTransition(async () => {
      const result = await deleteJobPdf({ jobId, documentKind });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  };
  const editable = jobStatus === "en_progreso" || jobStatus === "enviado_revision";

  return <section className="rounded-2xl border border-black bg-white p-5 text-black shadow-lg">
    <h2 className="text-xl font-bold">Documentos</h2>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <article className="rounded-xl border border-black bg-white p-4">
        <h3 className="font-bold">PDF original</h3>
        <p className="mt-1 text-sm text-black">Documento recibido, sin modificaciones.</p>
        {originalPath ? <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => open(originalPath)} className="min-h-11 rounded-lg border border-black bg-white px-4 font-semibold text-black disabled:opacity-60">Ver PDF original</button>{canDelete && <button type="button" disabled={pending} onClick={() => remove("original")} className="min-h-11 rounded-lg border border-black bg-white px-4 font-semibold text-black disabled:opacity-60">Eliminar PDF original</button>}</div> : <p className="mt-4 text-sm text-black">No disponible</p>}
      </article>
      <article className="rounded-xl border border-black bg-white p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="font-bold">PDF entregado por técnico</h3><span className={`rounded-full px-3 py-1 text-xs font-bold ${deliveredStatus === "current" ? "bg-white text-black" : deliveredStatus === "stale" ? "bg-white text-black" : "bg-white text-black"}`}>{statusCopy[deliveredStatus]}</span></div>
        <p className="mt-1 text-sm text-black">Original más las evidencias fotográficas confirmadas.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {deliveredPath && <button type="button" disabled={pending} onClick={() => open(deliveredPath)} className="min-h-11 rounded-lg border border-black bg-white px-4 font-semibold text-black disabled:opacity-60">Ver PDF entregado</button>}
          {canDelete && deliveredPath && <button type="button" disabled={pending} onClick={() => remove("delivered")} className="min-h-11 rounded-lg border border-black bg-white px-4 font-semibold text-black disabled:opacity-60">Eliminar PDF entregado</button>}
          {canRegenerate && editable && originalPath && <button type="button" disabled={pending} onClick={regenerate} className="min-h-11 rounded-lg bg-black px-4 font-bold text-white disabled:opacity-60">{deliveredPath ? "Regenerar" : "Generar"}</button>}
        </div>
      </article>
    </div>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-black">{pending ? "Procesando…" : message}</p>
  </section>;
}
