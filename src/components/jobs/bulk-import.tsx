"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { assignJobsInBulk } from "@/lib/jobs/actions";
import { confirmBulkProjectUpload, prepareBulkProjectUpload } from "@/lib/storage/actions";
import { extractPdfPreview, mapWithConcurrency } from "@/lib/jobs/pdf-parser";
import type { PdfDraft } from "@/lib/jobs/pdf-parser";
import type { AssigneeOption } from "@/lib/jobs/types";
import {
  applyImportOutcome, applyPdfPreview, createImportRows, filterImportRows, groupAssignmentChunks, importProgress, pageRows,
  selectUploadTargets, type ImportRow, type ImportState,
} from "./bulk-import-model";
import { AssigneeSelect } from "./assignee-select";
import { Button, buttonClasses } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const stateLabels: Record<ImportState, string> = {
  pending: "Pendiente", processing: "Procesando", imported: "Importado",
  duplicate: "Duplicado", error: "Error",
};

const stateTone: Record<ImportState, string> = {
  pending: "pdf_pending",
  processing: "archivado",
  imported: "aprobado",
  duplicate: "archivado",
  error: "incidencia",
};

function assigneeValue(row: ImportRow) {
  return row.assigneeType && row.assigneeId ? `${row.assigneeType}:${row.assigneeId}` : "";
}

function parseAssignee(value: string) {
  const [type, id] = value.split(":");
  return type === "technician" && id
    ? { assigneeType: "technician" as const, assigneeId: id }
    : { assigneeType: undefined, assigneeId: undefined };
}

export function BulkImport({ options }: { options: AssigneeOption[] }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ImportState | "all">("all");
  const [page, setPage] = useState(1);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<string | null>(null);
  useEffect(() => { batchRef.current = localStorage.getItem("jobs-import-batch"); }, []);

  const filtered = useMemo(() => filterImportRows(rows, query, stateFilter), [rows, query, stateFilter]);
  const visible = pageRows(filtered, page);
  const progress = importProgress(rows);
  const selectedPending = rows.filter((row) => row.selected && (row.state === "pending" || row.state === "error")).length;
  const selectedAssignable = rows.filter((row) => row.selected && (
    row.state === "pending" || row.state === "error" || row.assignmentState === "error"
  )).length;

  function patchRow(key: string, patch: Partial<ImportRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    if (rows.length + files.length > 100) { setMessage("Cada lote admite como máximo 100 archivos."); return; }
    const additions = createImportRows(files);
    setRows((current) => [...current, ...additions]);
    setMessage(`Analizando ${additions.length} archivo(s)…`);
    await mapWithConcurrency(additions, 2, async (row) => {
      try {
        const preview = await extractPdfPreview(row.file);
        setRows((current) => applyPdfPreview(current, row.key, preview));
      } catch (error) {
        patchRow(row.key, { state: "error", selected: false, message: error instanceof Error ? error.message : "No se pudo analizar el archivo." });
      }
    });
    setMessage("Previsualización lista. Corrige los datos y confirma la asignación si corresponde.");
  }

  function choose(fileList: FileList | null) {
    void addFiles(Array.from(fileList ?? []));
    if (inputRef.current) inputRef.current.value = "";
  }

  function updateFields(key: string, fields: Partial<PdfDraft>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, fields: { ...row.fields, ...fields } } : row));
  }

  function setRowAssignee(key: string, value: string) {
    patchRow(key, parseAssignee(value));
  }

  function applyBulkAssignee() {
    const assignment = parseAssignee(bulkAssignee);
    setRows((current) => current.map((row) =>
      row.selected && (row.state === "pending" || row.state === "error" || row.assignmentState === "error")
        ? { ...row, ...assignment, assignmentState: row.assignmentState === "error" ? "pending" : row.assignmentState }
        : row,
    ));
    setMessage(bulkAssignee ? `Asignación aplicada a ${selectedAssignable} fila(s).` : "Asignación eliminada de las filas seleccionadas.");
  }

  async function processRow(snapshot: ImportRow) {
    patchRow(snapshot.key, { state: "processing", message: "Cargando PDF privado…" });
    try {
      let row = snapshot;
      if (!row.fileHash) {
        const preview = await extractPdfPreview(row.file);
        row = { ...row, ...preview, fields: preview.fields };
        setRows((current) => applyPdfPreview(current, row.key, preview));
      }
      const prepare = (batchId: string | null) => prepareBulkProjectUpload({
        batchId,
        fileName: row.file.name,
        fileHash: row.fileHash!,
        fileSize: row.file.size,
        mimeType: row.file.type,
        pdfHeader: "%PDF-",
        fields: row.fields,
      });
      let prepared = await prepare(batchRef.current);
      if (!prepared.success && prepared.reason === "batch_unavailable" && batchRef.current) {
        batchRef.current = null;
        localStorage.removeItem("jobs-import-batch");
        prepared = await prepare(null);
      }
      if (!prepared.success) throw new Error(prepared.message);
      if (prepared.data.batchId !== batchRef.current) {
        batchRef.current = prepared.data.batchId; localStorage.setItem("jobs-import-batch", prepared.data.batchId);
      }
      patchRow(row.key, { itemId: prepared.data.itemId });
      if (prepared.data.token) {
        const upload = await supabase.storage.from("project-files").uploadToSignedUrl(
          prepared.data.path, prepared.data.token, row.file, { contentType: "application/pdf" },
        );
        if (upload.error) throw new Error("No se pudo subir el PDF a Storage privado.");
      }
      const confirmed = prepared.data.status === "imported" || prepared.data.status === "duplicate"
        ? { success: true as const, data: { status: prepared.data.status, jobId: prepared.data.jobId }, message: "Importación recuperada." }
        : await confirmBulkProjectUpload({
          itemId: prepared.data.itemId,
          assigneeType: row.assigneeType,
          assigneeId: row.assigneeId,
        });
      if (!confirmed.success) throw new Error(confirmed.message);
      const status: "duplicate" | "imported" = confirmed.data.status === "duplicate" ? "duplicate" : "imported";
      setRows((current) => applyImportOutcome(current, row.key, { status, jobId: confirmed.data.jobId, message: confirmed.message })
        .map((item) => item.key === row.key ? {
          ...item,
          assignmentState: status === "imported" && row.assigneeId ? "assigned" : undefined,
        } : item));
      return null;
    } catch (error) {
      setRows((current) => applyImportOutcome(current, snapshot.key, {
        status: "error",
        message: error instanceof Error ? error.message : "No se pudo importar el archivo.",
      }));
      return null;
    }
  }

  async function assignGroups(groups: ReturnType<typeof groupAssignmentChunks>) {
    for (const group of groups) {
      let result;
      try { result = await assignJobsInBulk({ jobIds: group.jobIds, assigneeType: group.assigneeType, assigneeId: group.assigneeId }); }
      catch { result = { success: false as const, message: "No se pudo completar la asignación." }; }
      const keys = new Set(group.rowKeys);
      setRows((current) => current.map((row) => keys.has(row.key) ? { ...row, assignmentState: result.success ? "assigned" : "error", message: result.success ? `${row.message} Asignado.` : `${row.message} Asignación pendiente: ${result.message}` } : row));
    }
  }

  async function retryAssignments() {
    setBusy(true); await assignGroups(groupAssignmentChunks(rows)); setBusy(false);
  }

  function startNewBatch() {
    localStorage.removeItem("jobs-import-batch"); batchRef.current = null; setRows([]); setPage(1); setMessage("Nuevo lote listo.");
  }

  async function importRows(retryOnly: boolean) {
    const targets = selectUploadTargets(rows, retryOnly).filter((row) => retryOnly || row.selected);
    if (!targets.length) { setMessage("No hay archivos seleccionados para procesar."); return; }
    setBusy(true);
    setMessage(`Procesando ${targets.length} archivo(s) con hasta 3 cargas simultáneas…`);
    const remaining = [...targets];
    // Establish or validate the shared batch before concurrent rows use it. This
    // also makes stale localStorage recovery deterministic for the whole batch.
    const first = remaining.shift();
    if (first) await processRow(first);
    await mapWithConcurrency(remaining, 3, async (row) => { await processRow(row); });
    setBusy(false);
    setMessage("Lote finalizado. Revisa los resultados por archivo.");
  }

  const allVisibleSelected = visible.rows.length > 0 && visible.rows.every((row) => row.selected);
  function toggleVisible() {
    const keys = new Set(visible.rows.map((row) => row.key));
    setRows((current) => current.map((row) => keys.has(row.key) ? { ...row, selected: !allVisibleSelected } : row));
  }

  return <div className="grid gap-5">
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}
        className="rounded-xl border-2 border-dashed border-line-strong p-8 text-center hover:border-accent-500"
      >
        <p className="font-semibold text-ink">Arrastra aquí tus órdenes PDF</p>
        <p className="mt-1 text-sm text-ink-soft">O selecciona hasta 100 archivos de 25 MB cada uno.</p>
        <label className={`${buttonClasses({ variant: "primary" })} mt-4 cursor-pointer focus-within:outline-2`}>
          Seleccionar PDF
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple onChange={(event) => choose(event.target.files)} className="sr-only" />
        </label>
      </div>
      {rows.length > 0 && <div className="mt-5">
        <div className="flex items-center justify-between gap-3 text-sm"><strong>{progress.complete} de {progress.total} finalizados</strong><span>{progress.percent}%</span></div>
        <progress value={progress.complete} max={progress.total} className="mt-2 h-3 w-full" />
      </div>}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">{message}</p>
    </section>

    {rows.length > 0 && <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr_2fr_auto]">
        <label className="grid gap-1 text-sm font-medium text-ink-soft">Buscar<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Archivo, orden o dirección" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
        <label className="grid gap-1 text-sm font-medium text-ink-soft">Estado<select value={stateFilter} onChange={(event) => { setStateFilter(event.target.value as ImportState | "all"); setPage(1); }} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="all">Todos</option>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium text-ink-soft">Asignación masiva<AssigneeSelect options={options} value={bulkAssignee} onChange={setBulkAssignee} /></label>
        <Button type="button" onClick={applyBulkAssignee} disabled={!selectedAssignable} className="self-end" variant="secondary" size="sm">Aplicar a {selectedAssignable}</Button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1180px] border-separate border-spacing-y-2 text-sm">
          <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-muted"><th className="px-2"><input type="checkbox" aria-label="Seleccionar filas visibles" checked={allVisibleSelected} onChange={toggleVisible} /></th><th>Archivo y estado</th><th>Número PRISM</th><th>Dirección</th><th>Fecha y tipo</th><th>Cliente y descripción</th><th>Asignación</th></tr></thead>
          <tbody>{visible.rows.map((row) => {
            const locked = row.state === "processing" || row.state === "imported" || row.state === "duplicate";
            const assignmentLocked = locked && row.assignmentState !== "error";
            return <tr key={row.key} className="align-top">
              <td className="rounded-l-xl border border-line bg-white p-3"><input type="checkbox" aria-label={`Seleccionar ${row.file.name}`} checked={row.selected} disabled={locked} onChange={() => patchRow(row.key, { selected: !row.selected })} /></td>
              <td className="border border-line bg-white p-3"><strong className="block max-w-48 break-all text-ink">{row.file.name}</strong><StatusBadge status={stateTone[row.state]} label={stateLabels[row.state]} className="mt-2" /><p className="mt-2 max-w-52 text-xs text-ink-muted">{row.message}</p></td>
              <td className="border border-line bg-white p-3"><input aria-label={`Número PRISM de ${row.file.name}`} value={row.fields.orderIdentifier ?? ""} disabled={locked} onChange={(event) => updateFields(row.key, { orderIdentifier: event.target.value || null, prismNumber: event.target.value || null })} placeholder="Número PRISM" className="w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /></td>
              <td className="border border-line bg-white p-3"><input aria-label={`Dirección de ${row.file.name}`} value={row.fields.address ?? ""} disabled={locked} onChange={(event) => updateFields(row.key, { address: event.target.value || null })} placeholder="Dirección" className="mb-2 w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /><input aria-label={`Ubicación de ${row.file.name}`} value={row.fields.location ?? ""} disabled={locked} onChange={(event) => updateFields(row.key, { location: event.target.value || null })} placeholder="Ciudad, estado, ZIP" className="w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /></td>
              <td className="border border-line bg-white p-3"><input type="date" aria-label={`Fecha de ${row.file.name}`} value={row.fields.requestDate ?? ""} disabled={locked} onChange={(event) => updateFields(row.key, { requestDate: event.target.value || null })} className="mb-2 w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /><input aria-label={`Tipo de trabajo de ${row.file.name}`} value={row.fields.jobType ?? ""} disabled={locked} onChange={(event) => updateFields(row.key, { jobType: event.target.value || null })} placeholder="Tipo de trabajo" className="w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /></td>
              <td className="border border-line bg-white p-3"><input aria-label={`Cliente de ${row.file.name}`} value={row.fields.customerName ?? ""} disabled={locked} onChange={(event) => updateFields(row.key, { customerName: event.target.value || null })} placeholder="Cliente (si aparece)" className="mb-2 w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /><textarea aria-label={`Descripción de ${row.file.name}`} value={row.fields.description ?? ""} disabled={locked} onChange={(event) => updateFields(row.key, { description: event.target.value || null })} rows={3} className="w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /></td>
              <td className="rounded-r-xl border border-line bg-white p-3"><fieldset disabled={assignmentLocked}><AssigneeSelect ariaLabel={`Asignación de ${row.file.name}`} options={options} value={assigneeValue(row)} onChange={(value) => setRowAssignee(row.key, value)} className="w-full rounded-xl border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /></fieldset>{row.responsibleSuggestion && <p className="mt-2 rounded-lg border border-line bg-surface-muted p-2 text-xs text-ink-soft">Sugerencia: {row.responsibleSuggestion}. Confirma manualmente una opción.</p>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2"><Button type="button" disabled={visible.page <= 1} onClick={() => setPage((value) => value - 1)} variant="secondary" size="sm">Anterior</Button><span className="px-2 py-2 text-sm text-ink-soft">Página {visible.page} de {visible.pages}</span><Button type="button" disabled={visible.page >= visible.pages} onClick={() => setPage((value) => value + 1)} variant="secondary" size="sm">Siguiente</Button></div>
        <div className="flex flex-wrap gap-3"><Button type="button" onClick={() => void importRows(false)} disabled={busy || !selectedPending} variant="primary">{busy ? "Procesando…" : `Importar seleccionados (${selectedPending})`}</Button>{rows.some((row) => row.state === "error") && <Button type="button" onClick={() => void importRows(true)} disabled={busy} variant="secondary">Reintentar fallidos</Button>}{rows.some((row) => row.assignmentState === "error") && <Button type="button" onClick={() => void retryAssignments()} disabled={busy} variant="secondary">Reintentar asignaciones</Button>}<Button type="button" onClick={startNewBatch} disabled={busy} variant="secondary">Iniciar lote nuevo</Button></div>
      </div>
    </section>}
  </div>;
}
