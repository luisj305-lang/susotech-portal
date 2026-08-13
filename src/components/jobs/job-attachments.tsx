"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobDocument } from "@/lib/jobs/types";
import {
  createSignedDownloadUrl,
  deleteJobDocument,
  prepareJobDocumentUpload,
  reconcileJobDocumentUploads,
} from "@/lib/storage/actions";
import { supabase } from "@/lib/supabase/client";

const PDF_LIMIT = 25 * 1024 * 1024;

export function JobAttachments({
  jobId,
  documents,
  canManage,
}: {
  jobId: string;
  documents: JobDocument[];
  canManage: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const [pending, startTransition] = useTransition();

  const open = (path: string) => startTransition(async () => {
    const result = await createSignedDownloadUrl({ bucket: "project-files", path });
    setMessage(result.message);
    if (result.success) window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  });

  const upload = () => {
    const files = [...(input.current?.files ?? [])];
    if (!files.length) { setMessage("Selecciona al menos un PDF."); return; }
    const invalid = files.find((file) => file.type !== "application/pdf"
      || !file.name.toLowerCase().endsWith(".pdf")
      || file.name.trim().length > 255
      || file.size < 1 || file.size > PDF_LIMIT);
    if (invalid) { setMessage(`${invalid.name} no es un PDF válido o supera 25 MB.`); return; }

    startTransition(async () => {
      let completed = 0;
      const failures: string[] = [];
      for (const [index, file] of files.entries()) {
        setProgress(`Subiendo ${index + 1} de ${files.length}: ${file.name}`);
        const fileHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const prepared = await prepareJobDocumentUpload({
          jobId, fileName: file.name, mimeType: file.type, size: file.size, fileHash,
        });
        if (!prepared.success) { failures.push(`${file.name}: ${prepared.message}`); continue; }

        const uploaded = await supabase.storage.from("project-files").uploadToSignedUrl(
          prepared.data.path,
          prepared.data.token,
          file,
          { contentType: "application/pdf" },
        );
        if (uploaded.error) {
          await deleteJobDocument({ documentId: prepared.data.documentId, jobId });
          failures.push(`${file.name}: no se pudo subir`);
          continue;
        }

        const confirmationResponse = await fetch(`/api/trabajos/${jobId}/documentos/${prepared.data.documentId}/confirmar`, {
          method: "POST",
        });
        const confirmed = await confirmationResponse.json().catch(() => ({ success: false, message: "No se pudo confirmar el adjunto." }));
        if (!confirmationResponse.ok || !confirmed.success) {
          await deleteJobDocument({ documentId: prepared.data.documentId, jobId });
          failures.push(`${file.name}: ${confirmed.message}`);
          continue;
        }
        completed += 1;
      }
      setProgress("");
      setMessage(failures.length
        ? `${completed} adjunto(s) añadido(s). ${failures.join(" ")}`
        : `${completed} adjunto(s) añadido(s).`);
      if (input.current) input.current.value = "";
      if (completed) router.refresh();
    });
  };

  const remove = (document: JobDocument) => {
    if (!window.confirm(`¿Eliminar el adjunto ${document.display_name}? Esta acción no se puede deshacer.`)) return;
    startTransition(async () => {
      const result = await deleteJobDocument({ documentId: document.id, jobId });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  };

  return <section className="rounded-2xl border border-white bg-black p-5 text-white shadow-lg">
    <h2 className="text-xl font-bold">Adjuntos PDF</h2>
    <p className="mt-1 text-sm text-white">Documentos adicionales; no reemplazan el PDF original ni el entregado.</p>
    {documents.length ? <ul className="mt-4 grid gap-3">{documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white p-3">
      <div><p className="font-semibold">{document.position}. {document.display_name}</p><p className="text-sm">{(document.size_bytes / 1024 / 1024).toFixed(2)} MB · {document.page_count ?? "?"} página(s)</p></div>
      <div className="flex gap-2"><button type="button" disabled={pending} onClick={() => open(document.storage_path)} className="min-h-11 rounded-lg border border-white px-4 font-semibold disabled:opacity-60">Ver PDF</button>{canManage && <button type="button" disabled={pending} onClick={() => remove(document)} className="min-h-11 rounded-lg border border-white px-4 font-semibold disabled:opacity-60">Eliminar</button>}</div>
    </li>)}</ul> : <p className="mt-4 text-sm">No hay adjuntos adicionales.</p>}
    {canManage && <div className="mt-5 grid gap-3 border-t border-white pt-4"><label className="grid gap-1 font-semibold">Añadir uno o más PDFs<input ref={input} type="file" accept="application/pdf,.pdf" multiple disabled={pending} className="min-h-12 rounded-lg border border-white p-3" /></label><div className="flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={upload} className="min-h-12 w-fit rounded-lg border border-white px-5 font-bold disabled:opacity-60">{pending ? "Procesando…" : "Subir PDFs"}</button><button type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await reconcileJobDocumentUploads({ jobId }); setMessage(result.message); if (result.success) router.refresh(); })} className="min-h-12 w-fit rounded-lg border border-white px-5 font-semibold disabled:opacity-60">Recuperar cargas interrumpidas</button></div></div>}
    <p role="status" aria-live="polite" className="mt-3 text-sm">{progress || message}</p>
  </section>;
}
