"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { optimizeJobRoute, saveRouteOrigin } from "@/lib/jobs/routing-actions";
import type { RouteCandidate } from "@/lib/jobs/routing-queries";

type RouteResult = {
  orderedJobs: Array<{ id: string; label: string; address: string; postalCode: string | null }>;
  distanceMeters: number;
  duration: string;
};

function durationLabel(value: string) {
  const seconds = Number.parseFloat(value.replace(/s$/u, ""));
  if (!Number.isFinite(seconds)) return value;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export function RoutePlanner({ candidates, initialOrigin }: { candidates: RouteCandidate[]; initialOrigin: string }) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => setSelected((current) => current.includes(id)
    ? current.filter((value) => value !== id)
    : current.length < 25 ? [...current, id] : current);

  const saveOrigin = () => startTransition(async () => {
    const response = await saveRouteOrigin({ originAddress: origin });
    setMessage(response.message);
  });

  const optimize = () => startTransition(async () => {
    setResult(null);
    const response = await optimizeJobRoute({ jobIds: selected });
    setMessage(response.message);
    if (response.success) setResult(response.data);
  });

  return <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
    <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
      <h2 className="text-lg font-semibold text-ink">Origen y regreso</h2>
      <p className="mt-1 text-sm text-ink-soft">El recorrido empieza y termina en esta dirección.</p>
      <label className="mt-4 grid gap-1 text-sm font-medium text-ink-soft">Dirección del portal<input value={origin} onChange={(event) => setOrigin(event.target.value)} maxLength={500} disabled={pending} placeholder="Dirección completa, ciudad, estado y ZIP" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
      <Button type="button" className="mt-3" variant="secondary" disabled={pending || !origin.trim()} onClick={saveOrigin}>Guardar origen</Button>
      <div className="mt-6 border-t border-line pt-4">
        <p className="font-semibold text-ink">{selected.length} de 25 seleccionados</p>
        <Button type="button" className="mt-3 w-full" disabled={pending || selected.length < 1} onClick={optimize}>{pending ? "Calculando…" : "Optimizar ida y vuelta"}</Button>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-soft">{message}</p>
      </div>
    </section>

    <div className="grid gap-5">
      <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-semibold text-ink">Trabajos activos</h2>
        <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto">
          {candidates.map((job) => <label key={job.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-surface-muted">
            <input type="checkbox" checked={selected.includes(job.id)} disabled={pending || (!selected.includes(job.id) && selected.length >= 25)} onChange={() => toggle(job.id)} className="mt-1" />
            <span className="min-w-0"><strong className="block text-ink">{job.label}</strong><span className="block text-sm text-ink-soft">{job.address}</span><span className="text-xs text-ink-muted">ZIP: {job.postalCode ?? "sin registrar"} · Ubicación Google: {job.geocodingStatus === "resolved" ? "lista" : "se resolverá al optimizar"}</span></span>
          </label>)}
          {!candidates.length && <p className="text-sm text-ink-soft">No hay trabajos activos con dirección.</p>}
        </div>
      </section>

      {result && <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-semibold text-ink">Recorrido optimizado</h2>
        <p className="mt-1 text-sm text-ink-soft">{(result.distanceMeters / 1609.344).toFixed(1)} mi · {durationLabel(result.duration)} · ida y vuelta</p>
        <ol className="mt-4 grid gap-2">{result.orderedJobs.map((job, index) => <li key={job.id} className="flex gap-3 rounded-xl border border-line p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-900 text-sm font-bold text-white">{index + 1}</span><span><Link href={`/trabajos/${job.id}`} className="font-semibold text-accent-600 underline">{job.label}</Link><span className="block text-sm text-ink-soft">{job.address}</span></span></li>)}</ol>
        <p className="mt-4 text-xs text-ink-muted">Este resultado no se guarda. Vuelve a optimizar si cambian los trabajos o el origen.</p>
      </section>}
    </div>
  </div>;
}
