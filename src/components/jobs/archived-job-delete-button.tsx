"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteArchivedJob,
  retryPendingJobDeletionCleanup,
} from "@/lib/jobs/actions";

export function ArchivedJobDeleteButton({
  jobId,
  label,
}: {
  jobId: string;
  label: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const remove = () => {
    if (!window.confirm(
      `¿Eliminar permanentemente ${label}? Se borrarán el trabajo, sus documentos y evidencias. Esta acción no se puede deshacer.`,
    )) return;

    startTransition(async () => {
      const result = await deleteArchivedJob({ jobId });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  };

  return <div className="mt-3 grid gap-2">
    <button
      type="button"
      disabled={pending}
      onClick={remove}
      className="min-h-11 w-fit rounded-lg border border-black px-5 font-bold text-white disabled:opacity-60"
    >
      {pending ? "Eliminando…" : "Eliminar permanentemente"}
    </button>
    <p role="status" aria-live="polite" className="text-sm text-black">{message}</p>
  </div>;
}

export function RetryJobDeletionCleanupButton() {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  return <div className="grid gap-2">
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => {
        const result = await retryPendingJobDeletionCleanup();
        setMessage(result.message);
      })}
      className="rounded-lg border border-black px-5 py-3 font-semibold disabled:opacity-60"
    >
      {pending ? "Limpiando…" : "Reintentar limpieza pendiente"}
    </button>
    <p role="status" aria-live="polite" className="text-sm text-black">{message}</p>
  </div>;
}
