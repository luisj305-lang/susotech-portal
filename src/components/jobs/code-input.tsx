"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProductionCode } from "@/lib/jobs/actions";
import type { ProductionCatalogOption } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";

const unitLabels = { fixed: "Cantidad", foot: "Pies realizados", hour: "Horas", event: "Eventos" } as const;
const rateUnits = { fixed: "unidad", foot: "pie", hour: "hora", event: "evento" } as const;

export function CodeInput({ jobId, enabled, catalog }: { jobId: string; enabled: boolean; catalog: ProductionCatalogOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [catalogId, setCatalogId] = useState(catalog[0]?.id ?? "");
  const selected = catalog.find((item) => item.id === catalogId);

  function submit(data: FormData) {
    startTransition(async () => {
      const result = await addProductionCode({
        jobId,
        catalogId: String(data.get("catalogId") ?? ""),
        quantity: Number(data.get("quantity")),
        notes: String(data.get("notes") ?? ""),
      });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  }

  return <section className="rounded-2xl border border-line bg-white p-6 text-ink shadow-card">
    <h2 className="text-xl font-bold">Código de producción</h2>
    <form action={submit} className="mt-4 grid gap-3">
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Actividad
        <select name="catalogId" value={catalogId} onChange={(event) => setCatalogId(event.target.value)} required disabled={!enabled || !catalog.length} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none">
          {catalog.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.description}</option>)}
        </select>
      </label>
      {selected && <p className="text-sm text-ink-soft">{selected.unit_rate == null ? "Sin tarifa configurada" : `Tarifa aplicable: $${Number(selected.unit_rate).toFixed(3)} por ${rateUnits[selected.unit]}`}</p>}
      <label className="grid gap-1 text-sm font-medium text-ink-soft">{selected ? unitLabels[selected.unit] : "Cantidad"}
        <input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required disabled={!enabled} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">Notas<input name="notes" disabled={!enabled} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
      <Button disabled={pending || !enabled || !catalog.length || selected?.unit_rate == null} variant="primary" size="lg">{pending ? "Guardando…" : "Añadir código"}</Button>
    </form>
    {!enabled && <p className="mt-3 text-sm text-ink-soft">Inicia el trabajo antes de registrar producción.</p>}
    {!catalog.length && <p className="mt-3 text-sm text-ink-soft">No hay códigos disponibles para tu tipo de técnico.</p>}
    <p role="status" aria-live="polite" className="mt-2 text-ink-muted">{message}</p>
  </section>;
}
