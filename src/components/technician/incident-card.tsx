"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setIncident } from "@/lib/jobs/actions";
import type { IncidentType } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export function IncidentCard({
  jobId,
  incident,
}: {
  jobId: string;
  incident: IncidentType | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ success: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      if (result.success) router.refresh();
    });

  return (
    <section
      className={cn(
        "rounded-2xl border border-line bg-white p-6 text-ink shadow-card",
        incident && "border-l-4 border-l-red-400",
      )}
    >
      <h2 className="text-xl font-bold text-ink">Incidencia</h2>
      {incident ? (
        <Alert variant="danger" className="mt-3">
          Hay una incidencia registrada en este trabajo.
        </Alert>
      ) : null}
      <form
        action={(data) =>
          run(() =>
            setIncident({
              jobId,
              incident: (String(data.get("incident")) || null) as IncidentType | null,
              notes: String(data.get("notes") ?? ""),
            }),
          )
        }
        className="mt-4 grid gap-3"
      >
        <label className="grid gap-1 text-sm font-medium text-ink-soft">
          Incidencia
          <select
            name="incident"
            defaultValue={incident ?? ""}
            className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
          >
            <option value="">Sin incidencia / resolver</option>
            <option value="need_splicing">Requiere empalme</option>
            <option value="no_access">Sin acceso</option>
            <option value="need_cr">Requiere CR</option>
            <option value="permit_pending">Permiso pendiente</option>
            <option value="returned">Devuelto</option>
            <option value="incomplete">Incompleto</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-ink-soft">
          Notas
          <input
            name="notes"
            className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
          />
        </label>
        <Button variant="primary" disabled={pending}>
          Guardar incidencia
        </Button>
      </form>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">
        {message}
      </p>
    </section>
  );
}
