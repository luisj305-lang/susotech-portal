"use client";

import { useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  createSignedDownloadUrl,
  deleteJobPdf,
  discardJobOriginalReplacementUpload,
  prepareJobOriginalReplacementUpload,
} from "@/lib/storage/actions";
import { supabase } from "@/lib/supabase/client";
import type { DeliveredPdfStatus, JobStatus } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const PDF_LIMIT = 25 * 1024 * 1024;

export function JobDocuments({
  jobId,
  originalPath,
  deliveredPath,
  deliveredStatus,
  jobStatus,
  canRegenerate = false,
  canDelete = false,
  attachments,
}: {
  jobId: string;
  originalPath: string | null;
  deliveredPath: string | null;
  deliveredStatus: DeliveredPdfStatus;
  jobStatus: JobStatus;
  canRegenerate?: boolean;
  canDelete?: boolean;
  attachments?: ReactNode;
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
  const editable = jobStatus === "asignado" || jobStatus === "en_revision";

  return <section className="rounded-2xl border border-line bg-white p-6 text-ink shadow-card">
    <h2 className="text-xl font-bold text-ink">Documentos</h2>
    <div className={`mt-4 grid gap-4 sm:grid-cols-2${attachments ? " xl:grid-cols-3" : ""}`}>
      <article className="rounded-xl border border-line bg-white p-4">
        <h3 className="font-bold text-ink">PDF original</h3>
        <p className="mt-1 text-sm text-ink-soft">Documento recibido, sin modificaciones.</p>
        {originalPath ? <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open(originalPath)}>Ver PDF original</Button>{canDelete && <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => remove("original")}>Eliminar PDF original</Button>}</div> : canDelete ? <div className="mt-4 grid gap-3"><p className="text-sm text-ink-soft">El original fue retirado. Sube un nuevo PDF para reiniciar el borrador de entrega.</p><input ref={originalInput} type="file" accept="application/pdf,.pdf" disabled={pending} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /><Button variant="primary" type="button" disabled={pending} onClick={uploadOriginal}>{pending ? "Procesando…" : "Subir nuevo PDF original"}</Button></div> : <p className="mt-4 text-sm text-ink-soft">No disponible</p>}
      </article>
      <article className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-ink">PDF entregado por técnico</h3><StatusBadge status={`pdf_${deliveredStatus}`} /></div>
        <p className="mt-1 text-sm text-ink-soft">Original más las evidencias fotográficas confirmadas.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {deliveredPath && <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open(deliveredPath)}>Ver PDF entregado</Button>}
          {canDelete && deliveredPath && <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => remove("delivered")}>Eliminar PDF entregado</Button>}
          {canRegenerate && editable && originalPath && <Button variant="primary" type="button" disabled={pending} onClick={regenerate}>{deliveredPath ? "Regenerar" : "Generar"}</Button>}
        </div>
      </article>
      {attachments}
    </div>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">{pending ? "Procesando…" : message}</p>
  </section>;
}
