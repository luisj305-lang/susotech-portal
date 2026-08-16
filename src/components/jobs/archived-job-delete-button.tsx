"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteArchivedJob,
  retryPendingJobDeletionCleanup,
} from "@/lib/jobs/actions";
import { buttonClasses } from "@/components/ui/button";

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
      className={`${buttonClasses({ variant: "danger" })} w-fit`}
    >
      {pending ? "Eliminando…" : "Eliminar permanentemente"}
    </button>
    <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p>
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
      className={buttonClasses({ variant: "secondary", size: "sm" })}
    >
      {pending ? "Limpiando…" : "Reintentar limpieza pendiente"}
    </button>
    <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p>
  </div>;
}
