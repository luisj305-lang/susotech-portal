"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProductionCode } from "@/lib/jobs/actions";
import type { ProductionCatalogOption } from "@/lib/jobs/types";

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

  return <section className="rounded-2xl bg-white p-5 text-black shadow-lg">
    <h2 className="text-xl font-bold">Código de producción</h2>
    <form action={submit} className="mt-4 grid gap-3">
      <label className="grid gap-1 font-semibold">Actividad
        <select name="catalogId" value={catalogId} onChange={(event) => setCatalogId(event.target.value)} required disabled={!enabled || !catalog.length} className="min-h-12 rounded-xl border p-3">
          {catalog.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.description}</option>)}
        </select>
      </label>
      {selected && <p className="text-sm">{selected.unit_rate == null ? "Sin tarifa configurada" : `Tarifa aplicable: $${Number(selected.unit_rate).toFixed(3)} por ${rateUnits[selected.unit]}`}</p>}
      <label className="grid gap-1 font-semibold">{selected ? unitLabels[selected.unit] : "Cantidad"}
        <input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required disabled={!enabled} className="min-h-12 rounded-xl border p-3" />
      </label>
      <label className="grid gap-1 font-semibold">Notas<input name="notes" disabled={!enabled} className="min-h-12 rounded-xl border p-3" /></label>
      <button disabled={pending || !enabled || !catalog.length || selected?.unit_rate == null} className="min-h-14 rounded-xl bg-black px-5 text-lg font-bold text-white disabled:opacity-50">{pending ? "Guardando…" : "Añadir código"}</button>
    </form>
    {!enabled && <p className="mt-3 text-sm text-black">Inicia el trabajo antes de registrar producción.</p>}
    {!catalog.length && <p className="mt-3 text-sm text-black">No hay códigos disponibles para tu tipo de técnico.</p>}
    <p role="status" aria-live="polite" className="mt-2">{message}</p>
  </section>;
}
