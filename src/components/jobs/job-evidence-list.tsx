"use client";

import { useState, useTransition } from "react";
import { createSignedDownloadUrl } from "@/lib/storage/actions";
import type { JobPhoto } from "@/lib/jobs/types";

export function JobEvidenceList({ photos }: { photos: JobPhoto[] }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const open = (path: string) => startTransition(async () => {
    const result = await createSignedDownloadUrl({ bucket: "job-evidence", path });
    setMessage(result.message);
    if (result.success) window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  });
  return <>
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">{photos.map((photo, index) => <li key={photo.id} className="rounded-lg border border-white bg-black p-3 text-white"><strong>Foto {photos.length - index}</strong><p className="text-sm text-white">{new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(photo.created_at))}</p>{photo.comment && <p className="mt-2 text-sm">{photo.comment}</p>}<button type="button" disabled={pending} onClick={() => open(photo.storage_path)} className="mt-3 min-h-10 rounded-lg border border-white px-3 text-sm font-semibold text-white disabled:opacity-60">Ver evidencia</button></li>)}</ul>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-white">{pending ? "Abriendo evidencia…" : message}</p>
  </>;
}
