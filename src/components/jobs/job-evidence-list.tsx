"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobPhoto } from "@/lib/jobs/types";
import { createSignedDownloadUrl } from "@/lib/storage/actions";
import { deleteJobPhoto } from "@/lib/jobs/actions";
import { Button } from "@/components/ui/button";

type EvidenceUrls = Record<string, string>;

const PHOTO_TYPE_LABELS: Record<JobPhoto["photo_type"], string> = {
  before: "Antes",
  after: "Después",
  evidence: "Evidencia",
};

export function JobEvidenceList({ photos, canDelete = false }: { photos: JobPhoto[]; canDelete?: boolean }) {
  const router = useRouter();
  const [evidenceUrls, setEvidenceUrls] = useState<EvidenceUrls>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [selectedPhoto, setSelectedPhoto] = useState<JobPhoto | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<JobPhoto | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEvidence() {
      const results = await Promise.all(
        photos.map(async (photo) => ({
          id: photo.id,
          result: await createSignedDownloadUrl({
            bucket: "job-evidence",
            path: photo.storage_path,
          }),
        })),
      );

      if (cancelled) return;

      const urls: EvidenceUrls = {};
      for (const { id, result } of results) {
        if (result.success) urls[id] = result.data.signedUrl;
      }
      setEvidenceUrls(urls);

      if (Object.keys(urls).length !== photos.length) {
        setMessage("No se pudieron cargar todas las evidencias.");
      }
    }

    void loadEvidence();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  useEffect(() => {
    if (!lightboxPhoto) return;
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxPhoto(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxPhoto]);

  return <>
    <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {photos.map((photo, index) => {
        const signedUrl = evidenceUrls[photo.id];

        return <li key={photo.id} className="overflow-hidden rounded-xl border border-line bg-white shadow-soft">
          <button
            type="button"
            disabled={pending || !signedUrl}
            onClick={() => setLightboxPhoto(photo)}
            className="relative block aspect-[4/3] w-full overflow-hidden bg-white disabled:cursor-wait"
            aria-label={`Abrir foto ${photos.length - index} en tamaño completo`}
          >
            {signedUrl
              ? <Image
                  src={signedUrl}
                  alt={`Evidencia fotográfica ${photos.length - index}`}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                  unoptimized
                />
              : <span className="flex h-full items-center justify-center text-sm text-ink-muted">Cargando foto…</span>}
          </button>
          <div className="p-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-ink">Foto {photos.length - index}</strong>
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">{PHOTO_TYPE_LABELS[photo.photo_type]}</span>
            </div>
            <p className="text-sm text-ink-soft">{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(photo.created_at))}</p>
            {photo.comment && <p className="mt-2 text-sm text-ink-soft">{photo.comment}</p>}
            {canDelete && <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => setSelectedPhoto(photo)} className="mt-3">Eliminar fotografía</Button>}
          </div>
        </li>;
      })}
    </ul>
    {lightboxPhoto && <div role="dialog" aria-modal="true" aria-label={`Foto ${photos.length - photos.indexOf(lightboxPhoto)}`} className="fixed inset-0 z-[60] flex items-center justify-center bg-brand-950/60 p-4" onClick={() => setLightboxPhoto(null)}>
      <div className="relative flex max-h-full max-w-4xl flex-col items-center" onClick={(event) => event.stopPropagation()}>
        <button ref={closeButtonRef} type="button" aria-label="Cerrar" onClick={() => setLightboxPhoto(null)} className="absolute right-2 top-2 z-10 rounded-full bg-brand-950/70 p-2 text-white hover:bg-brand-950">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
        {evidenceUrls[lightboxPhoto.id]
          ? <Image src={evidenceUrls[lightboxPhoto.id]} alt={`Evidencia fotográfica ${photos.length - photos.indexOf(lightboxPhoto)}`} width={1400} height={1050} className="max-h-[85vh] w-auto rounded-xl object-contain" unoptimized />
          : <span className="flex items-center justify-center p-8 text-sm text-white">Cargando foto…</span>}
        {lightboxPhoto.comment && <p className="mt-2 max-w-full text-sm text-white">{lightboxPhoto.comment}</p>}
      </div>
    </div>}
    {selectedPhoto && <div role="dialog" aria-modal="true" aria-labelledby="delete-photo-title" className="fixed inset-0 z-[70] flex items-center justify-center bg-brand-950/40 p-4"><div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 text-ink shadow-card"><h2 id="delete-photo-title" className="text-xl font-bold text-ink">Eliminar fotografía</h2>{evidenceUrls[selectedPhoto.id] && <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-xl border border-line"><Image src={evidenceUrls[selectedPhoto.id]} alt="Fotografía que se eliminará" fill className="object-cover" unoptimized /></div>}<dl className="mt-4 grid gap-2 text-sm"><div><dt className="font-bold text-ink">Técnico</dt><dd className="text-ink-soft">{selectedPhoto.uploader_name || "Usuario registrado"}</dd></div><div><dt className="font-bold text-ink">Fecha</dt><dd className="text-ink-soft">{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedPhoto.created_at))}</dd></div></dl><p className="mt-4 rounded-lg border border-line bg-surface-muted p-3 font-semibold text-ink">Esta acción eliminará la fotografía de la evidencia del trabajo y puede dejar desactualizado el PDF entregado.</p><div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" type="button" disabled={pending} onClick={() => setSelectedPhoto(null)}>Cancelar</Button><Button variant="dangerSolid" type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await deleteJobPhoto({ jobId: selectedPhoto.job_id, photoId: selectedPhoto.id }); setMessage(result.message); if (result.success) { setSelectedPhoto(null); router.refresh(); } })}>Sí, eliminar</Button></div></div></div>}
    <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">{message}</p>
  </>;
}
