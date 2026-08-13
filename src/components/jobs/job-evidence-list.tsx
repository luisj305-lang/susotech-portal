"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import type { JobPhoto } from "@/lib/jobs/types";
import { createSignedDownloadUrl } from "@/lib/storage/actions";

type EvidenceUrls = Record<string, string>;

export function JobEvidenceList({ photos }: { photos: JobPhoto[] }) {
  const [evidenceUrls, setEvidenceUrls] = useState<EvidenceUrls>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

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
          </div>
        </li>;
      })}
    </ul>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-white">{pending ? "Abriendo evidencia…" : message}</p>
  </>;
}
