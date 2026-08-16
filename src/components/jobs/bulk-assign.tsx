"use client";

import { useState, useTransition } from "react";
import { assignJobsInBulk } from "@/lib/jobs/actions";
import type { AssigneeOption } from "@/lib/jobs/types";
import { AssigneeSelect } from "./assignee-select";
import { Button } from "@/components/ui/button";

export type ImportedJob = { id: string; title: string };

export function BulkAssign({ jobs, options }: { jobs: ImportedJob[]; options: AssigneeOption[] }) {
  const [selected, setSelected] = useState(() => jobs.map((job) => job.id));
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function assign(formData: FormData) {
    const [assigneeType, assigneeId] = String(formData.get("assignee") ?? "").split(":");
    startTransition(async () => {
      const result = await assignJobsInBulk({ jobIds: selected, assigneeType: assigneeType as "technician", assigneeId });
      setMessage(result.message);
    });
  }

  return <section className="mt-6 rounded-2xl border border-line bg-white p-6 shadow-card"><h2 className="text-lg font-semibold text-ink">Asignar trabajos importados</h2><p className="mt-1 text-sm text-ink-soft">Selecciona uno para asignación individual o varios para asignación masiva.</p>
    <fieldset className="my-4 grid gap-2"><legend className="sr-only">Trabajos para asignar</legend>{jobs.map((job) => <label key={job.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-white p-3 text-ink"><input type="checkbox" checked={selected.includes(job.id)} onChange={() => toggle(job.id)} /> <span>{job.title}</span></label>)}</fieldset>
    <form action={assign} className="flex flex-col gap-3 sm:flex-row"><label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Responsable principal<AssigneeSelect name="assignee" options={options} required /></label><Button disabled={pending || !selected.length || !options.length} className="self-end" variant="primary">{pending ? "Asignando…" : `Asignar ${selected.length || ""}`}</Button></form>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">{message}</p>
  </section>;
}
