"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DeliveredPdfPageRemover({ jobId, deliveredPath }: { jobId: string; deliveredPath: string }) {
  const router = useRouter();
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);
  const previewUrl = `/api/trabajos/${jobId}/pdf-entregado/miniatura?expectedPath=${encodeURIComponent(deliveredPath)}`;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`${previewUrl}&page=1`, { cache: "no-store" });
        const count = Number(response.headers.get("x-page-count") ?? "0");
        if (active && response.ok && Number.isInteger(count) && count > 0) setPageCount(count);
      } catch {
        // Leave pageCount null; the component surfaces the unavailable state.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [previewUrl]);

  const toggle = (page: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page); else next.add(page);
      return next;
    });
  };

  const remove = async () => {
    if (pending || completed) return;
    if (!selected.size) { setMessage("Selecciona al menos una página."); return; }
    if (selected.size === pageCount) { setMessage("Debe quedar al menos una página en el PDF entregado."); return; }
    if (!window.confirm(`¿Quitar ${selected.size} página(s) del PDF entregado? Los archivos originales y las fotos de la galería se conservarán. Regenerar o volver a entregar el PDF restaurará las páginas desde sus fuentes.`)) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/trabajos/${jobId}/pdf-entregado/quitar-paginas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pages: [...selected].sort((left, right) => left - right), expectedPath: deliveredPath }),
      });
      const result = await response.json().catch(() => ({ message: "No se pudo recortar el PDF entregado." }));
      setMessage(result.message || "No se pudo recortar el PDF entregado.");
      if (response.ok || response.status === 409) {
        setCompleted(true);
        setSelected(new Set());
        router.refresh();
      }
    } catch {
      setMessage("No se pudo recortar el PDF entregado.");
    } finally {
      setPending(false);
    }
  };

  if (loading) return <p className="text-sm text-ink-soft">Cargando páginas del PDF entregado…</p>;
  if (pageCount === null) return <p className="text-sm text-ink-soft">No se pudo cargar el PDF entregado.</p>;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-soft">Selecciona las páginas que deseas quitar del PDF entregado. Los códigos, montos, reparto, originales y fotos de la galería no cambian. Regenerar o volver a entregar restaura las páginas desde sus fuentes.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
          <label key={page} className="grid cursor-pointer gap-2 rounded-xl border border-line bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${previewUrl}&page=${page}`}
              alt={`Página ${page}`}
              loading="lazy"
              className="w-full rounded-lg border border-line"
            />
            <span className="flex items-center gap-2 px-1 text-sm text-ink">
              <input type="checkbox" disabled={pending || completed} checked={selected.has(page)} onChange={() => toggle(page)} className="h-4 w-4 accent-brand-900" />
              Página {page}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" disabled={pending || completed || !selected.size || selected.size === pageCount} onClick={remove}>
          {pending ? "Procesando…" : `Quitar ${selected.size} página(s)`}
        </Button>
        {selected.size === pageCount && <p className="text-sm text-ink-soft">Debe quedar al menos una página.</p>}
        {completed && <Button type="button" variant="secondary" onClick={() => window.location.reload()}>Recargar páginas</Button>}
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p>
      </div>
    </div>
  );
}
