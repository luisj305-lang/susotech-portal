"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProductionCode } from "@/lib/jobs/actions";

export function CodeInput({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(data: FormData) {
    startTransition(async () => { const result = await addProductionCode({ jobId, code: String(data.get("code") ?? ""), quantity: Number(data.get("quantity")), notes: String(data.get("notes") ?? "") }); setMessage(result.message); if (result.success) router.refresh(); });
  }
  return <section className="rounded-2xl bg-black p-5 text-white shadow-lg"><h2 className="text-xl font-bold">Código de producción</h2><form action={submit} className="mt-4 grid gap-3"><label className="grid gap-1 font-semibold">Código<input name="code" required disabled={!enabled} className="min-h-12 rounded-xl border p-3" /></label><label className="grid gap-1 font-semibold">Cantidad<input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required disabled={!enabled} className="min-h-12 rounded-xl border p-3" /></label><label className="grid gap-1 font-semibold">Notas<input name="notes" disabled={!enabled} className="min-h-12 rounded-xl border p-3" /></label><button disabled={pending || !enabled} className="min-h-14 rounded-xl bg-black px-5 text-lg font-bold text-white disabled:opacity-50">{pending ? "Guardando…" : "Añadir código"}</button></form>{!enabled && <p className="mt-3 text-sm text-white">Inicia el trabajo antes de registrar producción.</p>}<p role="status" aria-live="polite" className="mt-2">{message}</p></section>;
}
