"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveJobPdfDraft } from "@/lib/jobs/actions";
import {
  clampPlacement,
  codeColor,
  placementLabel,
  validatePlacements,
  type PdfCodePlacement,
} from "@/lib/jobs/pdf-code-editor-core";
import { movePdfTextNote, resizePdfTextNote, validatePdfTextNotes, type PdfTextNote } from "@/lib/jobs/pdf-text-note-core";
import type { JobPdfDraft, ProductionCatalogOption } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";
import { IconX } from "@/components/ui/icons";

type SourcePage = { page: number; documentId: string; sourcePage: number };
type EditorNote = PdfTextNote & { editorId: string };

const NOTE_FONT_RATIO = 0.018;
const NOTE_PAD_X = 0.01;
const NOTE_PAD_Y = 0.006;
const NOTE_LINE_EM = 1.2;

function textWidthEm(text: string): number {
  if (typeof document === "undefined") return Array.from(text).length * 0.62;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return Array.from(text).length * 0.62;
  context.font = "100px Arial, Helvetica, sans-serif";
  return context.measureText(text).width / 100;
}

function measureNoteSize(text: string, fontSizeRatio: number): { width: number; height: number } {
  const lines = text.split("\n");
  const maxLineEm = Math.max(0, ...lines.map((line) => textWidthEm(line)));
  const width = Math.min(0.8, Math.max(0.08, maxLineEm * fontSizeRatio + NOTE_PAD_X * 2));
  const contentWidth = Math.max(0.01, width - NOTE_PAD_X * 2);
  const visualLines = lines.reduce((total, line) => {
    const lineFraction = textWidthEm(line) * fontSizeRatio;
    return total + Math.max(1, Math.ceil(lineFraction / contentWidth));
  }, 0);
  const height = Math.min(0.6, Math.max(0.04, visualLines * NOTE_LINE_EM * fontSizeRatio + NOTE_PAD_Y * 2));
  return { width, height };
}

type PageProps = {
  jobId: string;
  page: number;
  selectedCatalogId: string;
  addingNote?: boolean;
  selectedId: string | null;
  placements: PdfCodePlacement[];
  notes: EditorNote[];
  catalog: ProductionCatalogOption[];
  onMetadata: (pageCount: number, draftVersion: number) => void;
  onAdd: (page: number, x: number, y: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onMoveArrow: (id: string, x: number, y: number) => void;
  onSelectNote: (id: string) => void;
  onMoveNote: (id: string, dx: number, dy: number) => void;
  onResizeNote: (id: string, dx: number, dy: number) => void;
  sourcePage: SourcePage;
};

function PdfPage({ jobId, page, selectedCatalogId, addingNote = true, selectedId, placements, notes, catalog, onMetadata, onAdd, onSelect, onMove, onMoveArrow, onSelectNote, onMoveNote, onResizeNote, sourcePage }: PageProps) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; kind: "box" | "arrow" | "note" | "note-resize"; x: number; y: number } | null>(null);
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
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "No se pudo cargar esta página.");
      }
      objectUrl = URL.createObjectURL(await response.blob());
      if (!active) return URL.revokeObjectURL(objectUrl);
      setImageUrl(objectUrl);
      onMetadata(Number(response.headers.get("x-page-count") ?? 0), Number(response.headers.get("x-draft-version") ?? 0));
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "No se pudo cargar esta página."));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [jobId, onMetadata, page, visible]);

  const pagePlacements = placements.filter((item) => item.page === page);
  return <section aria-labelledby={`pdf-page-${page}`} className="mx-auto w-full max-w-5xl">
    <h2 id={`pdf-page-${page}`} className="mb-2 text-sm font-bold text-ink">Página {page}</h2>
    <div ref={host} className="relative min-h-[55vh] w-full overflow-hidden border border-line bg-white shadow-card [container-type:inline-size]">
      {!imageUrl && <div className="flex min-h-[55vh] items-center justify-center bg-surface-muted p-6 text-center text-ink-muted">{error || (visible ? "Cargando página…" : "La página se cargará al acercarte")}</div>}
      {imageUrl && <div role="application" aria-label={`Colocar código en la página ${page}`} onClick={(event) => {
        if ((!selectedCatalogId && !addingNote) || drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onAdd(sourcePage.page, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      }} onPointerMove={(event) => {
        if (!drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (drag.current.kind === "box") {
          onMove(drag.current.id, (event.clientX - drag.current.x) / rect.width, (event.clientY - drag.current.y) / rect.height);
        } else if (drag.current.kind === "arrow") {
          onMoveArrow(
            drag.current.id,
            (event.clientX - rect.left) / rect.width,
            (event.clientY - rect.top) / rect.height,
          );
        } else if (drag.current.kind === "note") onMoveNote(drag.current.id, (event.clientX - drag.current.x) / rect.width, (event.clientY - drag.current.y) / rect.height);
        else onResizeNote(drag.current.id, (event.clientX - drag.current.x) / rect.width, (event.clientY - drag.current.y) / rect.height);
        drag.current = { ...drag.current, x: event.clientX, y: event.clientY };
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} className="relative block w-full touch-pan-y cursor-crosshair text-left">
        {/* This authenticated blob URL cannot use the Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={`PDF original, página ${page}`} className="block h-auto w-full" />
        {notes.filter((note) => note.page === page).map((note) => <div key={note.editorId} role="button" tabIndex={0} aria-label={`Nota de texto en página ${page}`} onClick={(event) => { event.stopPropagation(); onSelectNote(note.editorId); }} onPointerDown={(event) => { event.stopPropagation(); onSelectNote(note.editorId); drag.current = { id: note.editorId, kind: "note", x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `${note.x * 100}%`, top: `${note.y * 100}%`, width: `${note.width * 100}%`, height: `${note.height * 100}%`, fontSize: `${note.fontSizeRatio * 100}cqw` }} className={`absolute z-[5] touch-none cursor-move overflow-hidden whitespace-pre-wrap border bg-white p-1 text-ink ${selectedId === note.editorId ? "border-blue-700 ring-2 ring-blue-300" : "border-black"}`}>
          {note.text}{selectedId === note.editorId && <button type="button" aria-label="Redimensionar nota" onPointerDown={(event) => { event.stopPropagation(); onSelectNote(note.editorId); drag.current = { id: note.editorId, kind: "note-resize", x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} className="absolute bottom-0 right-0 h-6 w-6 touch-none cursor-nwse-resize border-l border-t border-line bg-blue-600" />}
        </div>)}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <defs><marker id={`arrow-${page}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs>
          {pagePlacements.map((item) => {
            const catalogItem = catalog.find((entry) => entry.id === item.catalogId);
            const color = codeColor(catalogItem?.code ?? item.catalogId);
            return <line key={item.id} x1={`${(item.x + item.width / 2) * 100}%`} y1={`${(item.y + item.height / 2) * 100}%`} x2={`${item.arrowTipX * 100}%`} y2={`${item.arrowTipY * 100}%`} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" markerEnd={`url(#arrow-${page})`} />;
          })}
        </svg>
        {pagePlacements.map((item) => {
          const catalogItem = catalog.find((entry) => entry.id === item.catalogId);
          const label = placementLabel(item, catalogItem?.code ?? "Código");
          const color = codeColor(catalogItem?.code ?? item.catalogId);
          const fittedFontSize = Math.max(0.1, (item.width * 100 - 0.8) / Math.max(1, label.length * 0.62));
          return <span key={item.id} role="button" tabIndex={0} aria-label={`${label} en página ${page}`} onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item.id); } }} onPointerDown={(event) => { event.stopPropagation(); onSelect(item.id); drag.current = { id: item.id, kind: "box", x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%`, backgroundColor: "#ffffff", borderColor: color, color: "#000000", fontSize: `min(12px, ${fittedFontSize}cqw)` }} className={`absolute z-10 flex cursor-move items-center overflow-hidden whitespace-nowrap border-2 px-1 font-bold ${selectedId === item.id ? "ring-2 ring-black" : ""}`}>{label}</span>;
        })}
        {pagePlacements.map((item) => <button key={`tip-${item.id}`} type="button" aria-label={`Mover extremo de la flecha de ${catalog.find((entry) => entry.id === item.catalogId)?.code ?? "código"}`} onClick={(event) => { event.stopPropagation(); onSelect(item.id); }} onPointerDown={(event) => { event.stopPropagation(); onSelect(item.id); drag.current = { id: item.id, kind: "arrow", x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} style={{ left: `calc(${item.arrowTipX * 100}% - 12px)`, top: `calc(${item.arrowTipY * 100}% - 12px)`, backgroundColor: codeColor(catalog.find((entry) => entry.id === item.catalogId)?.code ?? item.catalogId) }} className={`absolute z-20 h-6 w-6 touch-none rounded-full border-2 ${selectedId === item.id ? "border-black ring-2 ring-white" : "border-white"}`} />)}
      </div>}
    </div>
  </section>;
}

type AllocationParticipant = { id: string; label: string; worker_specialty: string };

export function PdfCodeEditor({ jobId, actorId, participants, catalog, initialDraft, sourcePages }: {
  jobId: string;
  actorId: string;
  participants: AllocationParticipant[];
  catalog: ProductionCatalogOption[];
  initialDraft: JobPdfDraft | null;
  sourcePages: SourcePage[];
}) {
  const router = useRouter();
  const [allocations, setAllocations] = useState<Array<{ participantId: string; percentage: string }>>([
    { participantId: actorId, percentage: "100.00" },
  ]);
  const [pageCount, setPageCount] = useState(sourcePages.length || initialDraft?.source_page_count || 1);
  const [version, setVersion] = useState(initialDraft?.version ?? 0);
  const versionRef = useRef(initialDraft?.version ?? 0);
  const [placements, setPlacements] = useState<PdfCodePlacement[]>(() => (initialDraft?.placements ?? []).map((placement) => {
    const source = sourcePages.find((item) => item.page === placement.page);
    return {
      ...placement,
      sourceDocumentId: placement.sourceDocumentId || source?.documentId || "",
      sourcePage: placement.sourcePage || source?.sourcePage || placement.page,
      quantity: placement.quantity || 0,
      arrowTipX: Number.isFinite(placement.arrowTipX) ? placement.arrowTipX : Math.min(1, placement.x + placement.width / 2 + 0.14),
      arrowTipY: Number.isFinite(placement.arrowTipY) ? placement.arrowTipY : placement.y + placement.height / 2,
    };
  }));
  const [notes, setNotes] = useState<EditorNote[]>(() => (initialDraft?.text_notes ?? []).map((note) => ({ ...note, editorId: crypto.randomUUID() })));
  const [tool, setTool] = useState<"code" | "note">("code");
  const [stage, setStage] = useState<"edit" | "allocation">("edit");
  const [noteText, setNoteText] = useState("");
  const [selectedCatalogId, setSelectedCatalogId] = useState(catalog[0]?.id ?? "");
  const [newQuantity, setNewQuantity] = useState("1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasLegacyPlacements = placements.some((placement) => placement.quantity <= 0);
  const [message, setMessage] = useState(hasLegacyPlacements ? "Completa la cantidad de cada código antes de entregar." : "Preparando los PDFs fuente…");
  const [dirty, setDirty] = useState(hasLegacyPlacements);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const changeGeneration = useRef(0);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const placementsRef = useRef(placements);
  const notesRef = useRef(notes);
  placementsRef.current = placements;
  notesRef.current = notes;
  const selected = placements.find((item) => item.id === selectedId) ?? null;
  const selectedNote = notes.find((item) => item.editorId === selectedId) ?? null;
  const priceCategoryName = catalog.find((item) => item.price_category_name)?.price_category_name ?? null;
  const hasUnratedPlacement = placements.some((placement) => catalog.find((item) => item.id === placement.catalogId)?.unit_rate == null);
  const estimatedTotal = placements.reduce((sum, placement) => {
    const rate = catalog.find((item) => item.id === placement.catalogId)?.unit_rate;
    if (rate == null) return sum;
    return sum + placement.quantity * Number(rate);
  }, 0);
  const estimatedAmountFor = (percentage: string) => (estimatedTotal * (Number(percentage) || 0)) / 100;

  const onMetadata = useCallback((count: number, draftVersion: number) => {
    if (count > 0) setPageCount(count);
    if (!initialDraft) setVersion((current) => {
      const next = Math.max(current, draftVersion);
      versionRef.current = next;
      return next;
    });
    setMessage((current) => current === "Preparando los PDFs fuente…" ? "Tocá cualquier página para colocar el código seleccionado." : current);
  }, [initialDraft]);

  const change = useCallback((next: PdfCodePlacement[]) => {
    if (submitting) return;
    changeGeneration.current += 1; setPlacements(next); setDirty(true); setMessage("Cambios sin guardar…");
  }, [submitting]);

  const changeNotes = useCallback((next: EditorNote[]) => {
    if (submitting) return;
    changeGeneration.current += 1; setNotes(next); setDirty(true); setMessage("Cambios sin guardar…");
  }, [submitting]);

  const save = useCallback((current: PdfCodePlacement[], currentNotes: EditorNote[]) => {
    if (saveInFlight.current) return saveInFlight.current;
    const operation = (async () => {
      try {
        const validation = validatePlacements(current, pageCount);
        if (validation) { setMessage(validation); return false; }
        const invalidQuantity = current.find((placement) => {
          const unit = catalog.find((item) => item.id === placement.catalogId)?.unit;
          return (unit === "fixed" || unit === "event") && !Number.isInteger(placement.quantity);
        });
        if (invalidQuantity) { setMessage("Los códigos de cantidad fija o evento requieren un entero mayor que cero."); return false; }
        const generation = changeGeneration.current;
        setSaving(true); setMessage("Guardando borrador…");
        const sourceDocuments = [...new Set(sourcePages.map((source) => source.documentId))].map((id) => ({
          id,
          pageCount: Math.max(...sourcePages.filter((source) => source.documentId === id).map((source) => source.sourcePage)),
        }));
        const persistedNotes = currentNotes.map((note) => ({
          page: note.page, sourceDocumentId: note.sourceDocumentId, sourcePage: note.sourcePage,
          text: note.text, x: note.x, y: note.y, width: note.width, height: note.height,
          fontSizeRatio: note.fontSizeRatio,
        }));
        const noteValidation = validatePdfTextNotes(persistedNotes, sourceDocuments);
        if (noteValidation) { setMessage("Hay una nota inválida. Revisá el texto y sus límites."); return false; }
        const result = await saveJobPdfDraft({
          jobId,
          expectedVersion: versionRef.current,
          pageCount,
          placements: current,
          textNotes: persistedNotes,
          sourceDocuments,
        });
        setMessage(result.message);
        if (!result.success) return false;
        versionRef.current = result.data.version;
        setVersion(result.data.version);
        if (changeGeneration.current === generation) setDirty(false);
        return true;
      } catch {
        setMessage("No se pudo guardar el borrador. Inténtalo nuevamente.");
        return false;
      } finally {
        setSaving(false);
      }
    })();
    saveInFlight.current = operation;
    void operation.then(() => {
      if (saveInFlight.current === operation) saveInFlight.current = null;
    });
    return operation;
  }, [catalog, jobId, pageCount, sourcePages]);

  useEffect(() => {
    if (!dirty || saving || submitting) return;
    const timeout = setTimeout(() => void save(placements, notes), 900);
    return () => clearTimeout(timeout);
  }, [dirty, notes, placements, save, saving, submitting]);

  const persistStableDraft = async () => {
    const activeSave = saveInFlight.current;
    if (activeSave && !await activeSave) return false;
    for (;;) {
      const generation = changeGeneration.current;
      if (!await save(placementsRef.current, notesRef.current)) return false;
      if (changeGeneration.current === generation) return true;
    }
  };

  const add = (page: number, x: number, y: number) => {
    if (submitting) return;
    if (tool === "note") {
      const text = noteText.trim();
      if (!text) { setMessage("Escribí el texto de la nota antes de colocarla."); return; }
      const source = sourcePages.find((item) => item.page === page);
      if (!source) { setMessage("No se pudo identificar la página fuente."); return; }
      const { width, height } = measureNoteSize(text, NOTE_FONT_RATIO);
      const note: EditorNote = {
        editorId: crypto.randomUUID(), page, sourceDocumentId: source.documentId,
        sourcePage: source.sourcePage, text,
        x: Math.min(1 - width, Math.max(0, x - width / 2)),
        y: Math.min(1 - height, Math.max(0, y - height / 2)),
        width, height, fontSizeRatio: NOTE_FONT_RATIO,
      };
      changeNotes([...notes, note]); setSelectedId(note.editorId); setSheetOpen(false); return;
    }
    if (!selectedCatalogId) return;
    if (catalog.find((entry) => entry.id === selectedCatalogId)?.unit_rate == null) {
      setMessage(priceCategoryName ? "Este código no tiene tarifa configurada para tu categoría." : "Tu categoría de precio no está configurada. Contacta a un administrador.");
      return;
    }
    const quantity = Number(newQuantity);
    const unit = catalog.find((entry) => entry.id === selectedCatalogId)?.unit;
    if (!Number.isFinite(quantity) || quantity <= 0 || Math.round(quantity * 100) !== quantity * 100
      || ((unit === "fixed" || unit === "event") && !Number.isInteger(quantity))) {
      setMessage(unit === "fixed" || unit === "event" ? "La cantidad debe ser un entero mayor que cero." : "La cantidad debe ser mayor que cero y tener máximo dos decimales.");
      return;
    }
    const width = 0.14; const height = 0.05;
    const boxX = Math.min(1 - width, Math.max(0, x - width / 2));
    const boxY = Math.min(1 - height, Math.max(0, y - height / 2));
    const centerX = boxX + width / 2; const centerY = boxY + height / 2;
    const source = sourcePages.find((item) => item.page === page);
    if (!source) { setMessage("No se pudo identificar la página fuente."); return; }
    const item = clampPlacement({
      id: crypto.randomUUID(), catalogId: selectedCatalogId, page,
      sourceDocumentId: source.documentId, sourcePage: source.sourcePage,
      quantity, x: boxX, y: boxY, width, height,
      arrowTipX: Math.min(1, centerX + 0.14), arrowTipY: centerY,
    });
    const next = [...placements, item]; const error = validatePlacements(next, pageCount);
    if (error) { setMessage(error); return; }
    change(next); setSelectedId(item.id); setSheetOpen(false);
  };
  const update = (id: string, patch: Partial<PdfCodePlacement>) => {
    if (submitting) return;
    const current = placements.find((item) => item.id === id); if (!current) return;
    const next = placements.map((item) => item.id === id ? clampPlacement({ ...current, ...patch }) : item);
    const error = validatePlacements(next, pageCount); if (error) { setMessage(error); return; }
    change(next);
  };
  const editNoteText = (id: string, text: string) => {
    if (submitting) return;
    changeNotes(notes.map((note) => {
      if (note.editorId !== id) return note;
      const { width, height } = measureNoteSize(text, note.fontSizeRatio);
      return { ...note, text, width, height };
    }));
  };
  const confirm = async () => {
    const requestedAllocations = allocations.map((item) => ({
      participantId: item.participantId,
      percentageBasisPoints: Math.round(Number(item.percentage) * 100),
    }));
    if (!requestedAllocations.length
      || requestedAllocations.some((item) => !Number.isInteger(item.percentageBasisPoints) || item.percentageBasisPoints <= 0)
      || new Set(requestedAllocations.map((item) => item.participantId)).size !== requestedAllocations.length
      || requestedAllocations.reduce((sum, item) => sum + item.percentageBasisPoints, 0) !== 10000) {
      setMessage("La distribución debe usar participantes únicos, porcentajes positivos y sumar exactamente 100.00%.");
      return;
    }
    setSubmitting(true);
    if (!await persistStableDraft()) { setSubmitting(false); return; }
    setMessage("Generando y enviando el PDF final…");
    const response = await fetch(`/api/trabajos/${jobId}/pdf-entregado`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      submit: true,
      allocations: requestedAllocations,
      allocationIdempotencyKey: crypto.randomUUID(),
    }) });
    const result = await response.json().catch(() => ({ message: "No se pudo entregar el trabajo." }));
    setMessage(result.message || "No se pudo entregar el trabajo."); setSubmitting(false);
    if (response.ok) router.replace(`/trabajos/${jobId}`);
  };
  const confirmPdf = async () => {
    setSubmitting(true);
    if (!await persistStableDraft()) { setSubmitting(false); return; }
    setSubmitting(false);
    setStage("allocation");
    setMessage("PDF confirmado. Completa la distribución financiera para entregar.");
  };
  const saveAndContinueLater = async () => {
    setSubmitting(true);
    if (!await persistStableDraft()) { setSubmitting(false); return; }
    router.replace(`/trabajos/${jobId}`);
  };

  return <main inert={submitting} aria-busy={submitting} className={`min-h-screen bg-white px-3 pt-4 text-ink sm:px-6 ${stage === "edit" ? "pb-40 sm:pb-36" : "pb-[28rem] sm:pb-80"}`}>
    <header className="mx-auto mb-5 max-w-5xl"><p className="text-sm font-semibold uppercase tracking-widest">Entrega del trabajo</p><h1 className="text-2xl font-bold sm:text-3xl">Marcá los códigos sobre el PDF</h1><p className="mt-2 text-sm text-ink-soft">El original permanece intacto. Todas las páginas están en orden y se cargan al acercarte.</p></header>
    <div className="grid gap-8">{sourcePages.map((sourcePage) => <PdfPage key={sourcePage.page} jobId={jobId} page={sourcePage.page} sourcePage={sourcePage} selectedCatalogId={selectedCatalogId} selectedId={selectedId} placements={placements} notes={notes} catalog={catalog} onMetadata={onMetadata} onAdd={add} onSelect={(id) => { setSelectedId(id); setSheetOpen(true); }} onSelectNote={(id) => { setSelectedId(id); setSheetOpen(true); }} onMoveNote={(id, dx, dy) => changeNotes(notes.map((note) => note.editorId === id ? { ...movePdfTextNote(note, dx, dy), editorId: note.editorId } : note))} onResizeNote={(id, dx, dy) => changeNotes(notes.map((note) => note.editorId === id ? { ...resizePdfTextNote(note, dx, dy), editorId: note.editorId } : note))} onMove={(id, requestedDx, requestedDy) => {
      const item = placements.find((entry) => entry.id === id); if (!item) return;
      const dx = Math.min(1 - item.x - item.width, 1 - item.arrowTipX, Math.max(-item.x, -item.arrowTipX, requestedDx));
      const dy = Math.min(1 - item.y - item.height, 1 - item.arrowTipY, Math.max(-item.y, -item.arrowTipY, requestedDy));
      update(id, { x: item.x + dx, y: item.y + dy, arrowTipX: item.arrowTipX + dx, arrowTipY: item.arrowTipY + dy });
    }} onMoveArrow={(id, x, y) => update(id, { arrowTipX: x, arrowTipY: y })} />)}</div>
    {stage === "edit" ? <>
    <div className="fixed inset-x-0 bottom-0 z-40">
      {sheetOpen && <div className="border-t border-line bg-white shadow-card">
        <div className="mx-auto max-h-[55vh] w-full max-w-5xl overflow-y-auto p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-bold">{selectedNote ? "Editar nota" : selected ? "Editar código" : tool === "note" ? "Nueva nota de texto" : "Nuevo código"}</h2>
            <button type="button" aria-label="Cerrar panel" onClick={() => { setSheetOpen(false); setSelectedId(null); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-ink hover:bg-surface-muted"><IconX /></button>
          </div>
          {selectedNote ? <div className="grid gap-2">
            <label className="grid gap-1 text-sm font-bold">Texto de la nota<textarea value={selectedNote.text} onChange={(event) => editNoteText(selectedNote.editorId, event.target.value)} rows={4} maxLength={2000} className="rounded-lg border border-line bg-white p-2" /></label>
            <p className="text-xs text-ink-soft">Nota · pág. {selectedNote.page}. Arrastrá para mover; usá la esquina azul para redimensionar.</p>
            <Button type="button" onClick={() => { changeNotes(notes.filter((note) => note.editorId !== selectedNote.editorId)); setSelectedId(null); }} variant="secondary" className="justify-self-start">Eliminar nota</Button>
          </div> : selected ? <div className="grid gap-3 sm:grid-cols-[9rem_1fr_auto]">
            <label className="grid gap-1 text-sm font-bold">Cantidad seleccionada<input aria-label="Cantidad del código seleccionado" inputMode="decimal" type="number" min="0.01" step="0.01" value={selected.quantity || ""} onChange={(event) => update(selected.id, { quantity: Number(event.target.value) })} className="min-h-11 rounded-lg border border-line bg-white p-2" /></label>
            <label className="flex items-center gap-2 text-sm font-bold">Tamaño<input aria-label="Tamaño del código seleccionado" type="range" min="4" max="30" value={Math.round(selected.width * 100)} onChange={(event) => update(selected.id, { width: Number(event.target.value) / 100, height: Number(event.target.value) / 240 })} className="w-full" /></label>
            <div className="flex items-end gap-3"><span className="text-xs text-ink-soft">Pág. {selected.page}</span><Button type="button" onClick={() => { change(placements.filter((item) => item.id !== selected.id)); setSelectedId(null); }} variant="secondary">Eliminar</Button></div>
          </div> : tool === "note" ? <div className="grid gap-2">
            <label className="grid gap-1 text-sm font-bold">Texto de la nota<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3} maxLength={2000} placeholder="Escribí el texto y tocá el PDF para colocarla" className="rounded-lg border border-line bg-white p-2" /></label>
            <Button type="button" onClick={() => setSheetOpen(false)} variant="primary" className="justify-self-start">Agregar nota</Button>
          </div> : <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <label className="grid min-w-0 gap-1 text-sm font-bold">Código<select aria-label="Código para colocar" value={selectedCatalogId} onChange={(event) => setSelectedCatalogId(event.target.value)} style={{ borderColor: codeColor(catalog.find((item) => item.id === selectedCatalogId)?.code ?? selectedCatalogId) }} className="min-h-12 w-full min-w-0 rounded-lg border-4 bg-white p-2"><option value="">Selecciona un código</option>{catalog.map((item) => <option key={item.id} value={item.id} style={{ color: codeColor(item.code) }}>{item.code} — {item.description} — {item.unit_rate == null ? "Sin tarifa configurada" : `$${Number(item.unit_rate).toFixed(3)}`}</option>)}</select></label>
            <label className="grid min-w-0 content-end gap-1 text-sm font-bold">Cantidad<input aria-label="Cantidad para el nuevo código" inputMode="decimal" type="number" min="0.01" step="0.01" value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)} className="min-h-12 min-w-0 rounded-lg border border-line bg-white p-2" /></label>
            <Button type="button" onClick={() => setSheetOpen(false)} className="self-end" variant="primary">Aplicar</Button>
          </div>}
          <p role="status" aria-live="polite" className="mt-3 min-h-4 text-xs text-ink-soft sm:hidden">{message || (dirty ? "Cambios sin guardar" : `Borrador guardado · versión ${version}`)}</p>
        </div>
      </div>}
      <div className="border-t border-line bg-white/95 shadow-card backdrop-blur">
        <div className="mx-auto w-full max-w-5xl p-2 sm:p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-2 sm:flex-none">
              <button type="button" onClick={() => { setTool("code"); setSelectedId(null); setSheetOpen(true); }} className={`min-h-11 flex-1 border px-3 text-sm font-bold sm:flex-none ${tool === "code" ? "border-brand-900 bg-brand-900 text-white" : "border-line bg-white text-ink"}`}>Código</button>
              <button type="button" onClick={() => { setTool("note"); setSelectedId(null); setSheetOpen(true); }} className={`min-h-11 flex-1 border px-3 text-sm font-bold sm:flex-none ${tool === "note" ? "border-brand-900 bg-brand-900 text-white" : "border-line bg-white text-ink"}`}>Nota de texto</button>
            </div>
            <p role="status" aria-live="polite" className="hidden min-w-0 flex-1 truncate text-xs text-ink-soft sm:block">{message || (dirty ? "Cambios sin guardar" : `Borrador guardado · versión ${version}`)}</p>
            <Button type="button" disabled={submitting} onClick={() => void saveAndContinueLater()} variant="secondary" className="min-h-11 flex-1 sm:flex-none">{saving ? "Guardando…" : <><span className="sm:hidden">Guardar</span><span className="hidden sm:inline">Guardar borrador</span></>}</Button>
            <Button type="button" disabled={saving || submitting} onClick={() => void confirmPdf()} variant="primary" className="min-h-11 flex-1 sm:flex-none">{submitting ? "Confirmando…" : <><span className="sm:hidden">Confirmar</span><span className="hidden sm:inline">Confirmar PDF</span></>}</Button>
          </div>
        </div>
      </div>
    </div>
    </> : <>
    <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto overflow-x-hidden border-t border-line bg-white/95 p-3 shadow-card backdrop-blur sm:p-4"><div className="mx-auto grid w-full min-w-0 max-w-5xl gap-3">
      <h2 className="text-lg font-bold">Distribución financiera</h2>
      <p className="text-xs text-ink-soft">Categoría aplicable: {priceCategoryName ?? "Sin categoría"}</p>
      <p className="text-xs text-ink-soft">Total estimado: ${estimatedTotal.toFixed(2)} · Los montos por participante son estimados; el servidor confirma los centavos exactos al entregar.</p>
      <details open className="max-h-48 overflow-auto border border-line p-2">
        <summary className="cursor-pointer text-sm font-bold">Distribución financiera ({allocations.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0).toFixed(2)}%)</summary>
        <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_6rem_6rem] items-center gap-2 text-xs font-bold text-ink-soft">
          <span />
          <span>Participante</span>
          <span>Porcentaje</span>
          <span className="text-right">Monto estimado</span>
        </div>
        <div className="mt-1 grid gap-2">
          {participants.map((participant) => {
            const selectedAllocation = allocations.find((item) => item.participantId === participant.id);
            return <div key={participant.id} className="grid grid-cols-[auto_minmax(0,1fr)_6rem_6rem] items-center gap-2 text-sm">
              <input aria-label={`Incluir a ${participant.label}`} type="checkbox" checked={Boolean(selectedAllocation)} onChange={(event) => setAllocations((current) => event.target.checked
                ? [...current, { participantId: participant.id, percentage: "0.00" }]
                : current.filter((item) => item.participantId !== participant.id))} />
              <span>{participant.label} · {participant.worker_specialty}</span>
              <input aria-label={`Porcentaje de ${participant.label}`} disabled={!selectedAllocation} inputMode="decimal" type="number" min="0.01" max="100" step="0.01" value={selectedAllocation?.percentage ?? ""} onChange={(event) => setAllocations((current) => current.map((item) => item.participantId === participant.id ? { ...item, percentage: event.target.value } : item))} className="min-h-10 border border-line bg-white p-2" />
              <span className="text-right font-semibold">{selectedAllocation ? `$${estimatedAmountFor(selectedAllocation.percentage).toFixed(2)}` : "—"}</span>
            </div>;
          })}
        </div>
      </details>
      {!priceCategoryName && <p role="alert" className="border border-line bg-white p-2 text-sm font-bold text-ink">Tu categoría de precio no está configurada. Contacta a un administrador antes de entregar.</p>}
      {hasUnratedPlacement && <p role="alert" className="border border-line bg-white p-2 text-sm font-bold text-ink">El borrador contiene un código sin tarifa configurada para tu categoría.</p>}
      <p role="status" aria-live="polite" className="min-h-5 text-sm">{message || (dirty ? "Cambios sin guardar" : `Borrador guardado · versión ${version}`)}</p>
      <div className="grid gap-2 sm:grid-cols-2"><Button type="button" disabled={submitting} onClick={() => setStage("edit")} variant="secondary">Volver a editar el PDF</Button><Button type="button" disabled={submitting || !priceCategoryName || hasUnratedPlacement} onClick={() => void confirm()} variant="primary">{submitting ? "Enviando…" : "Entregar trabajo"}</Button></div>
    </div></div>
    </>}
  </main>;
}
