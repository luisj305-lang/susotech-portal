"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { JobPhoto } from "@/lib/jobs/types";
import { createSignedDownloadUrl } from "@/lib/storage/actions";
import { deleteJobPhoto } from "@/lib/jobs/actions";

type EvidenceUrls = Record<string, string>;

export function JobEvidenceList({ photos, canDelete = false }: { photos: JobPhoto[]; canDelete?: boolean }) {
  const router = useRouter();
  const [evidenceUrls, setEvidenceUrls] = useState<EvidenceUrls>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [selectedPhoto, setSelectedPhoto] = useState<JobPhoto | null>(null);

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

  const open = (path: string) => startTransition(async () => {
    const result = await createSignedDownloadUrl({ bucket: "job-evidence", path });
    setMessage(result.message);
    if (result.success) window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  });

  return <>
    <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {photos.map((photo, index) => {
        const signedUrl = evidenceUrls[photo.id];

        return <li key={photo.id} className="overflow-hidden rounded-lg border border-white bg-black text-white">
          <button
            type="button"
            disabled={pending || !signedUrl}
            onClick={() => open(photo.storage_path)}
            className="relative block aspect-[4/3] w-full overflow-hidden bg-zinc-900 disabled:cursor-wait"
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
              : <span className="flex h-full items-center justify-center text-sm text-zinc-300">Cargando foto…</span>}
          </button>
          <div className="p-3">
            <strong>Foto {photos.length - index}</strong>
            <p className="text-sm text-white">{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(photo.created_at))}</p>
            {photo.comment && <p className="mt-2 text-sm">{photo.comment}</p>}
            {canDelete && <button type="button" disabled={pending} onClick={() => setSelectedPhoto(photo)} className="mt-3 min-h-11 rounded-lg border border-white px-3 font-semibold disabled:opacity-60">Eliminar fotografía</button>}
          </div>
        </li>;
      })}
    </ul>
    {selectedPhoto && <div role="dialog" aria-modal="true" aria-labelledby="delete-photo-title" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"><div className="w-full max-w-md rounded-2xl border border-white bg-black p-5 text-white shadow-2xl"><h2 id="delete-photo-title" className="text-xl font-bold">Eliminar fotografía</h2>{evidenceUrls[selectedPhoto.id] && <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-lg border border-white"><Image src={evidenceUrls[selectedPhoto.id]} alt="Fotografía que se eliminará" fill className="object-cover" unoptimized /></div>}<dl className="mt-4 grid gap-2 text-sm"><div><dt className="font-bold">Técnico</dt><dd>{selectedPhoto.uploader_name || "Usuario registrado"}</dd></div><div><dt className="font-bold">Fecha</dt><dd>{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedPhoto.created_at))}</dd></div></dl><p className="mt-4 border border-white p-3 font-semibold">Esta acción eliminará la fotografía de la evidencia del trabajo y puede dejar desactualizado el PDF entregado.</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={pending} onClick={() => setSelectedPhoto(null)} className="min-h-12 border border-white font-bold">Cancelar</button><button type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await deleteJobPhoto({ jobId: selectedPhoto.job_id, photoId: selectedPhoto.id }); setMessage(result.message); if (result.success) { setSelectedPhoto(null); router.refresh(); } })} className="min-h-12 bg-white font-bold text-black disabled:opacity-60">Sí, eliminar</button></div></div></div>}
    <p role="status" aria-live="polite" className="mt-3 text-sm text-white">{pending ? "Abriendo evidencia…" : message}</p>
  </>;
}
