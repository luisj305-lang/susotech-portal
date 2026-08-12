"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveJobPdfDraft } from "@/lib/jobs/actions";
import { clampPlacement, codeColor, validatePlacements, type PdfCodePlacement } from "@/lib/jobs/pdf-code-editor-core";
import type { JobPdfDraft, ProductionCatalogOption } from "@/lib/jobs/types";

type PageProps = {
  jobId: string;
  page: number;
  selectedCatalogId: string;
  selectedId: string | null;
  placements: PdfCodePlacement[];
  catalog: ProductionCatalogOption[];
  onMetadata: (pageCount: number, draftVersion: number) => void;
  onAdd: (page: number, x: number, y: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
};

function PdfPage({ jobId, page, selectedCatalogId, selectedId, placements, catalog, onMetadata, onAdd, onSelect, onMove }: PageProps) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(page === 1);
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const element = host.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "700px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true; let objectUrl = "";
    void fetch(`/api/trabajos/${jobId}/pdf-original-preview?page=${page}`, { method: "POST", cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("No se pudo cargar esta página.");
      objectUrl = URL.createObjectURL(await response.blob());
      if (!active) return URL.revokeObjectURL(objectUrl);
      setImageUrl(objectUrl);
      onMetadata(Number(response.headers.get("x-page-count") ?? 0), Number(response.headers.get("x-draft-version") ?? 0));
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "No se pudo cargar esta página."));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [jobId, onMetadata, page, visible]);

  const pagePlacements = placements.filter((item) => item.page === page);
  return <section aria-labelledby={`pdf-page-${page}`} className="mx-auto w-full max-w-5xl">
    <h2 id={`pdf-page-${page}`} className="mb-2 text-sm font-bold text-white">Página {page}</h2>
    <div ref={host} className="relative min-h-[55vh] w-full overflow-hidden border border-white/50 bg-white shadow-xl">
      {!imageUrl && <div className="flex min-h-[55vh] items-center justify-center bg-neutral-200 p-6 text-center text-black">{error || (visible ? "Cargando página…" : "La página se cargará al acercarte")}</div>}
      {imageUrl && <div role="application" aria-label={`Colocar código en la página ${page}`} onClick={(event) => {
        if (!selectedCatalogId || drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onAdd(page, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      }} onPointerMove={(event) => {
        if (!drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onMove(drag.current.id, (event.clientX - drag.current.x) / rect.width, (event.clientY - drag.current.y) / rect.height);
        drag.current = { id: drag.current.id, x: event.clientX, y: event.clientY };
      }} onPointerUp={() => { drag.current = null; }} className="relative block w-full touch-none cursor-crosshair text-left">
        {/* This authenticated blob URL cannot use the Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={`PDF original, página ${page}`} className="block h-auto w-full" />
        {pagePlacements.map((item) => {
          const catalogItem = catalog.find((entry) => entry.id === item.catalogId);
          return <span key={item.id} role="button" tabIndex={0} aria-label={`${catalogItem?.code ?? "Código"} en página ${page}`} onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item.id); } }} onPointerDown={(event) => { event.stopPropagation(); onSelect(item.id); drag.current = { id: item.id, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%`, backgroundColor: codeColor(catalogItem?.code ?? item.catalogId) }} className={`absolute flex cursor-move items-center overflow-hidden border-2 px-1 text-xs font-bold text-white ${selectedId === item.id ? "border-black ring-2 ring-white" : "border-white"}`}>{catalogItem?.code ?? "Código"}</span>;
        })}
      </div>}
    </div>
  </section>;
}

export function PdfCodeEditor({ jobId, catalog, initialDraft }: { jobId: string; catalog: ProductionCatalogOption[]; initialDraft: JobPdfDraft | null }) {
  const router = useRouter();
  const [pageCount, setPageCount] = useState(initialDraft?.source_page_count ?? 1);
  const [version, setVersion] = useState(initialDraft?.version ?? 0);
  const [placements, setPlacements] = useState<PdfCodePlacement[]>(initialDraft?.placements ?? []);
  const [selectedCatalogId, setSelectedCatalogId] = useState(catalog[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("Preparando el PDF original…");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const changeGeneration = useRef(0);
  const selected = placements.find((item) => item.id === selectedId) ?? null;

  const onMetadata = useCallback((count: number, draftVersion: number) => {
    if (count > 0) setPageCount(count);
    if (!initialDraft) setVersion((current) => Math.max(current, draftVersion));
    setMessage((current) => current === "Preparando el PDF original…" ? "Tocá cualquier página para colocar el código seleccionado." : current);
  }, [initialDraft]);

  const change = useCallback((next: PdfCodePlacement[]) => {
    changeGeneration.current += 1; setPlacements(next); setDirty(true); setMessage("Cambios sin guardar…");
  }, []);

  const save = useCallback(async (current: PdfCodePlacement[]) => {
    if (saving) return false;
    const validation = validatePlacements(current, pageCount);
    if (validation) { setMessage(validation); return false; }
    const generation = changeGeneration.current;
    setSaving(true); setMessage("Guardando borrador…");
    const result = await saveJobPdfDraft({ jobId, expectedVersion: version, pageCount, placements: current });
    setSaving(false); setMessage(result.message);
    if (!result.success) return false;
    setVersion(result.data.version);
    if (changeGeneration.current === generation) setDirty(false);
    return true;
  }, [jobId, pageCount, saving, version]);

  useEffect(() => {
    if (!dirty || saving || submitting) return;
    const timeout = setTimeout(() => void save(placements), 900);
    return () => clearTimeout(timeout);
  }, [dirty, placements, save, saving, submitting]);

  const add = (page: number, x: number, y: number) => {
    if (!selectedCatalogId) return;
    const item = clampPlacement({ id: crypto.randomUUID(), catalogId: selectedCatalogId, page, x: x - 0.06, y: y - 0.025, width: 0.12, height: 0.05 });
    const next = [...placements, item]; const error = validatePlacements(next, pageCount);
    if (error) { setMessage(error); return; }
    change(next); setSelectedId(item.id);
  };
  const update = (id: string, patch: Partial<PdfCodePlacement>) => {
    const current = placements.find((item) => item.id === id); if (!current) return;
    const next = placements.map((item) => item.id === id ? clampPlacement({ ...current, ...patch }) : item);
    const error = validatePlacements(next, pageCount); if (error) { setMessage(error); return; }
    change(next);
  };
  const confirm = async () => {
    setSubmitting(true);
    if (dirty && !await save(placements)) { setSubmitting(false); return; }
    setMessage("Generando y enviando el PDF final…");
    const response = await fetch(`/api/trabajos/${jobId}/pdf-entregado`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ submit: true }) });
    const result = await response.json().catch(() => ({ message: "No se pudo entregar el trabajo." }));
    setMessage(result.message || "No se pudo entregar el trabajo."); setSubmitting(false);
    if (response.ok) router.replace(`/trabajos/${jobId}`);
  };

  return <main className="min-h-screen bg-neutral-950 px-3 pb-72 pt-4 text-white sm:px-6">
    <header className="mx-auto mb-5 max-w-5xl"><p className="text-sm font-semibold uppercase tracking-widest">Entrega del trabajo</p><h1 className="text-2xl font-bold sm:text-3xl">Marcá los códigos sobre el PDF</h1><p className="mt-2 text-sm text-white/80">El original permanece intacto. Todas las páginas están en orden y se cargan al acercarte.</p></header>
    <div className="grid gap-8">{Array.from({ length: pageCount }, (_, index) => <PdfPage key={index + 1} jobId={jobId} page={index + 1} selectedCatalogId={selectedCatalogId} selectedId={selectedId} placements={placements} catalog={catalog} onMetadata={onMetadata} onAdd={add} onSelect={setSelectedId} onMove={(id, dx, dy) => { const item = placements.find((entry) => entry.id === id); if (item) update(id, { x: item.x + dx, y: item.y + dy }); }} />)}</div>
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/30 bg-black/95 p-3 shadow-2xl backdrop-blur sm:p-4"><div className="mx-auto grid max-w-5xl gap-3">
      <div className="grid grid-cols-[1fr_auto] gap-2"><label className="grid gap-1 text-sm font-bold">Código<select aria-label="Código para colocar" value={selectedCatalogId} onChange={(event) => setSelectedCatalogId(event.target.value)} style={{ borderColor: codeColor(catalog.find((item) => item.id === selectedCatalogId)?.code ?? selectedCatalogId) }} className="min-h-12 rounded-lg border-4 bg-black p-2">{catalog.map((item) => <option key={item.id} value={item.id} style={{ color: codeColor(item.code) }}>{item.code} — {item.description}</option>)}</select></label>{selected && <button type="button" onClick={() => { change(placements.filter((item) => item.id !== selected.id)); setSelectedId(null); }} className="self-end min-h-12 border border-white px-3 font-bold">Eliminar</button>}</div>
      {selected && <div className="flex items-center gap-3"><label className="flex flex-1 items-center gap-2 text-sm font-bold">Tamaño<input aria-label="Tamaño del código seleccionado" type="range" min="4" max="30" value={Math.round(selected.width * 100)} onChange={(event) => update(selected.id, { width: Number(event.target.value) / 100, height: Number(event.target.value) / 240 })} className="w-full" /></label><span className="text-xs">Pág. {selected.page}</span></div>}
      <p role="status" aria-live="polite" className="min-h-5 text-sm">{message || (dirty ? "Cambios sin guardar" : `Borrador guardado · versión ${version}`)}</p>
      <div className="grid grid-cols-2 gap-2"><Link href={`/trabajos/${jobId}`} className="flex min-h-12 items-center justify-center border border-white font-bold">Cancelar / Volver</Link><button type="button" disabled={saving || submitting} onClick={() => void confirm()} className="min-h-12 bg-white px-3 font-bold text-black disabled:opacity-50">{submitting ? "Enviando…" : "Confirmar y enviar"}</button></div>
    </div></div>
  </main>;
}
