"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createJobPart } from "@/lib/jobs/actions";
import { partLabel } from "@/lib/jobs/parts";
import type { Job } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";

export function PartActions({ jobId, parts }: { jobId: string; parts: Job[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const children = parts.slice(1);
  const addPart = () => startTransition(async () => {
    const result = await createJobPart({ jobId });
    setMessage(result.message);
    if (result.success) router.refresh();
  });

  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Partes del trabajo</h2>
        <Button type="button" disabled={pending} onClick={addPart} variant="primary">
          {pending ? "Agregando…" : "Agregar otra parte"}
        </Button>
      </div>
      <ul className="mt-3 grid gap-2">
        {parts.map((part) => {
          const label = partLabel(part, children);
          return (
            <li key={part.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted p-3 text-ink">
              <Link href={`/trabajos/${part.id}`} className="font-medium hover:underline">
                {part.prism_number ? `PRISM ${part.prism_number}` : part.address || part.location || "Sin número PRISM"}
              </Link>
              {label && <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-ink-soft">{label}</span>}
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">{message}</p>
    </section>
  );
}
