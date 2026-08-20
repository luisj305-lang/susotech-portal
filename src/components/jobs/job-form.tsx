"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJob, updateJob } from "@/lib/jobs/actions";
import type { Job, JobCategory } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";

const fields = [
  ["prismNumber", "Número PRISM", "prism_number"], ["njunsNumber", "Número NJUNS", "njuns_number"],
  ["address", "Dirección", "address"], ["location", "Ubicación", "location"], ["jobType", "Tipo de trabajo", "job_type"],
  ["customerName", "Cliente", "customer_name"],
  ["requiredMaterial", "Material requerido", "required_material"], ["projectMapUrl", "Enlace del mapa", "project_map_url"],
] as const;

export function JobForm({ job }: { job?: Job }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function submit(formData: FormData) {
    const value = (name: string) => String(formData.get(name) ?? "");
    const total = value("estimatedTotal");
    const input = {
      category: value("category") as JobCategory,
      prismNumber: value("prismNumber"), njunsNumber: value("njunsNumber"), address: value("address"),
      location: value("location"), customerName: value("customerName"), requestDate: value("requestDate") || null,
      jobType: value("jobType"), description: value("description"),
      specialInstructions: value("specialInstructions"), requiredMaterial: value("requiredMaterial"), projectMapUrl: value("projectMapUrl"),
      assignmentDate: value("assignmentDate") || null, deadlineDate: value("deadlineDate") || null, estimatedTotal: total ? Number(total) : null,
    };
    startTransition(async () => {
      const result = job ? await updateJob({ ...input, jobId: job.id }) : await createJob(input);
      setMessage(result.message);
      if (result.success) {
        if (job) router.refresh(); else if (result.data) router.push(`/trabajos/${result.data.id}`);
      }
    });
  }

  return <form action={submit} className="grid gap-4 rounded-2xl border border-line bg-white p-6 shadow-card sm:grid-cols-2">
    <label className="grid gap-1 text-sm font-medium text-ink-soft">Categoría<select name="category" defaultValue={job?.category ?? "categoria_1"} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="categoria_1">Categoría 1</option><option value="categoria_2">Categoría 2</option><option value="categoria_3">Categoría 3</option></select></label>
    {fields.map(([name, label, key]) => <label key={name} className="grid gap-1 text-sm font-medium text-ink-soft">{label}<input name={name} defaultValue={job?.[key] ?? ""} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>)}
    <label className="grid gap-1 text-sm font-medium text-ink-soft">Fecha de solicitud<input name="requestDate" type="date" defaultValue={job?.request_date ?? ""} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
    <label className="grid gap-1 text-sm font-medium text-ink-soft">Fecha de asignación<input name="assignmentDate" type="datetime-local" defaultValue={job?.assignment_date?.slice(0, 16) ?? ""} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Fecha límite<input name="deadlineDate" type="datetime-local" defaultValue={job?.deadline_date?.slice(0, 16) ?? ""} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
    <label className="grid gap-1 text-sm font-medium text-ink-soft">Total estimado<input name="estimatedTotal" type="number" min="0" step="0.01" defaultValue={job?.estimated_total ?? ""} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
    <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">Descripción<textarea name="description" rows={4} defaultValue={job?.description ?? ""} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">Instrucciones especiales<textarea name="specialInstructions" rows={3} defaultValue={job?.special_instructions ?? ""} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
    <div className="flex items-center gap-3 sm:col-span-2"><Button disabled={pending}>{pending ? "Guardando…" : job ? "Guardar cambios" : "Crear trabajo"}</Button><p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p></div>
  </form>;
}
