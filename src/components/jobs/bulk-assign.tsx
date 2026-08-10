"use client";

import { useState, useTransition } from "react";
import { assignJobsInBulk } from "@/lib/jobs/actions";
import type { AssigneeOption } from "@/lib/jobs/types";
import { AssigneeSelect } from "./assignee-select";

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
      const result = await assignJobsInBulk({ jobIds: selected, assigneeType: assigneeType as "technician" | "crew", assigneeId });
      setMessage(result.message);
    });
  }

  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Asignar trabajos importados</h2><p className="mt-1 text-sm text-slate-600">Selecciona uno para asignación individual o varios para asignación masiva.</p>
    <fieldset className="my-4 grid gap-2"><legend className="sr-only">Trabajos para asignar</legend>{jobs.map((job) => <label key={job.id} className="flex min-h-11 items-center gap-3 rounded-lg border p-3"><input type="checkbox" checked={selected.includes(job.id)} onChange={() => toggle(job.id)} /> <span>{job.title}</span></label>)}</fieldset>
    <form action={assign} className="flex flex-col gap-3 sm:flex-row"><label className="grid flex-1 gap-1 text-sm font-medium">Técnico individual o crew<AssigneeSelect name="assignee" options={options} required /></label><button disabled={pending || !selected.length || !options.length} className="self-end rounded-lg bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-60">{pending ? "Asignando…" : `Asignar ${selected.length || ""}`}</button></form>
    <p role="status" aria-live="polite" className="mt-3 text-sm">{message}</p>
  </section>;
}
