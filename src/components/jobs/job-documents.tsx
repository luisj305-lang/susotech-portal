"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSignedDownloadUrl,
  deleteJobPdf,
  discardJobOriginalReplacementUpload,
  prepareJobOriginalReplacementUpload,
} from "@/lib/storage/actions";
import { supabase } from "@/lib/supabase/client";
import type { DeliveredPdfStatus, JobStatus } from "@/lib/jobs/types";

const PDF_LIMIT = 25 * 1024 * 1024;

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
  const originalInput = useRef<HTMLInputElement>(null);
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
  const uploadOriginal = () => {
    const file = originalInput.current?.files?.[0];
    if (!file) { setMessage("Selecciona un PDF original."); return; }
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")
      || file.name.trim().length > 255 || file.size < 1 || file.size > PDF_LIMIT) {
      setMessage("El archivo no es un PDF válido o supera 25 MB.");
      return;
    }
    startTransition(async () => {
      let replacementId: string | null = null;
      try {
        const fileHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const prepared = await prepareJobOriginalReplacementUpload({
          jobId, fileName: file.name, mimeType: file.type, size: file.size, fileHash,
        });
        if (!prepared.success) { setMessage(prepared.message); return; }
        replacementId = prepared.data.documentId;
        const uploaded = await supabase.storage.from("project-files").uploadToSignedUrl(
          prepared.data.path,
          prepared.data.token,
          file,
          { contentType: "application/pdf" },
        );
        if (uploaded.error) throw new Error("No se pudo subir el nuevo PDF original.");
        const response = await fetch(
          `/api/trabajos/${jobId}/documentos/${prepared.data.documentId}/confirmar`,
          { method: "POST" },
        );
        const confirmed = await response.json().catch(() => ({
          success: false, message: "No se pudo verificar la confirmación del nuevo PDF original.",
        }));
        if (!response.ok || !confirmed.success) throw new Error(confirmed.message);
        if (originalInput.current) originalInput.current.value = "";
        setMessage(confirmed.message);
        router.refresh();
      } catch (error) {
        if (replacementId) {
          try {
            await discardJobOriginalReplacementUpload({ documentId: replacementId, jobId });
          } catch {
            // Confirmation may already have committed; the idempotent discard
            // intentionally leaves an active original untouched.
          }
        }
        setMessage(error instanceof Error ? error.message : "No se pudo reemplazar el PDF original.");
        router.refresh();
      }
    });
  };
  const editable = jobStatus === "en_progreso" || jobStatus === "enviado_revision";

  return <section className="rounded-2xl border border-black bg-white p-5 text-black shadow-lg">
    <h2 className="text-xl font-bold">Documentos</h2>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <article className="rounded-xl border border-black bg-white p-4">
        <h3 className="font-bold">PDF original</h3>
        <p className="mt-1 text-sm text-black">Documento recibido, sin modificaciones.</p>
        {originalPath ? <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => open(originalPath)} className="min-h-11 rounded-lg border border-black bg-white px-4 font-semibold text-black disabled:opacity-60">Ver PDF original</button>{canDelete && <button type="button" disabled={pending} onClick={() => remove("original")} className="min-h-11 rounded-lg border border-black bg-white px-4 font-semibold text-black disabled:opacity-60">Eliminar PDF original</button>}</div> : canDelete ? <div className="mt-4 grid gap-3"><p className="text-sm text-black">El original fue retirado. Sube un nuevo PDF para reiniciar el borrador de entrega.</p><input ref={originalInput} type="file" accept="application/pdf,.pdf" disabled={pending} className="min-h-12 rounded-lg border border-black p-3" /><button type="button" disabled={pending} onClick={uploadOriginal} className="min-h-11 w-fit rounded-lg bg-black px-4 font-bold text-white disabled:opacity-60">{pending ? "Procesando…" : "Subir nuevo PDF original"}</button></div> : <p className="mt-4 text-sm text-black">No disponible</p>}
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
