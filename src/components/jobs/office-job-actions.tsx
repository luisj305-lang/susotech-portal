"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignJob, correctInvoiceNumber, invoiceJob, setJobArchived, transitionJob, unassignJob } from "@/lib/jobs/actions";
import { createInvoiceUploadUrl, createSignedDownloadUrl } from "@/lib/storage/actions";
import { supabase } from "@/lib/supabase/client";
import type { AssigneeOption, JobAssignment, JobStatus } from "@/lib/jobs/types";
import { AssigneeSelect } from "./assignee-select";
import { Button } from "@/components/ui/button";

const nextOfficeStatus: Partial<Record<JobStatus, { status: JobStatus; label: string }>> = {
  en_revision: { status: "aprobado", label: "Aprobar trabajo" },
  facturado: { status: "pagado", label: "Marcar como pagado" },
};

export function OfficeJobActions({ jobId, status, assignment, options, canArchive, archived, invoiceNumber, invoicePath }: { jobId: string; status: JobStatus; assignment: JobAssignment | null; options: AssigneeOption[]; canArchive?: boolean; archived?: boolean; invoiceNumber?: string | null; invoicePath?: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceValue, setInvoiceValue] = useState(invoiceNumber ?? "");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const next = nextOfficeStatus[status];
  const current = assignment?.assignee_type === "technician" ? `technician:${assignment.technician_id}` : "";
  const run = (operation: () => Promise<{ success: boolean; message: string }>) => startTransition(async () => { const result = await operation(); setMessage(result.message); if (result.success) router.refresh(); });
  const openInvoice = () => { setInvoiceOpen(true); setMessage(""); };
  const submitInvoice = () => startTransition(async () => {
    const number = invoiceValue.trim();
    if (!number) { setMessage("El número de factura es obligatorio."); return; }
    let path: string | null | undefined;
    if (invoiceFile) {
      const prepared = await createInvoiceUploadUrl({ jobId, fileName: invoiceFile.name, mimeType: invoiceFile.type, size: invoiceFile.size });
      if (!prepared.success) { setMessage(prepared.message); return; }
      const uploaded = await supabase.storage.from("project-files").uploadToSignedUrl(prepared.data.path, prepared.data.token, invoiceFile, { contentType: invoiceFile.type });
      if (uploaded.error) { setMessage("No se pudo subir el archivo de factura."); return; }
      path = prepared.data.path;
    }
    const result = await (status === "aprobado"
      ? invoiceJob({ jobId, invoiceNumber: number, invoicePath: path })
      : correctInvoiceNumber({ jobId, invoiceNumber: number, invoicePath: path }));
    setMessage(result.message);
    if (result.success) { setInvoiceOpen(false); setInvoiceFile(null); router.refresh(); }
  });
  const openInvoiceFile = () => startTransition(async () => {
    const preview = window.open("about:blank", "_blank");
    if (!preview) { setMessage("El navegador bloqueó la ventana. Permite ventanas emergentes e inténtalo de nuevo."); return; }
    preview.opener = null;
    if (!invoicePath) { preview.close(); setMessage("La factura no tiene documento adjunto."); return; }
    const result = await createSignedDownloadUrl({ bucket: "project-files", path: invoicePath });
    setMessage(result.message);
    if (result.success) preview.location.replace(result.data.signedUrl);
    else preview.close();
  });

  return <section className="grid gap-4 rounded-2xl border border-line bg-white p-6 shadow-card">
    <h2 className="text-lg font-semibold text-ink">Asignación y estado</h2>
    {assignment?.assignee_type === "crew" && <p className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-ink">Este trabajo conserva una asignación histórica por crew. Selecciona un responsable individual para reemplazarla.</p>}
    <form action={(data) => { const [, assigneeId] = String(data.get("assignee")).split(":"); void run(() => assignJob({ jobId, assigneeType: "technician", assigneeId })); }} className="flex flex-col gap-3 sm:flex-row">
      <label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Asignar a<AssigneeSelect name="assignee" options={options} defaultValue={current} required /></label>
      <Button disabled={pending || !options.length} className="self-end" variant="secondary">Guardar asignación</Button>
      {assignment && status === "asignado" && <Button type="button" disabled={pending} onClick={() => run(() => unassignJob({ jobId }))} className="self-end" variant="secondary">Quitar asignación</Button>}
    </form>
    {next && <Button type="button" disabled={pending} onClick={() => run(() => transitionJob({ jobId, newStatus: next.status }))} className="w-fit" variant="primary">{next.label}</Button>}
    {status === "aprobado" && <Button type="button" disabled={pending} onClick={openInvoice} className="w-fit" variant="primary">Facturar trabajo</Button>}
    {status === "facturado" && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-muted p-3">
      <p className="text-sm text-ink">Factura: <strong>{invoiceNumber ?? "Sin número"}</strong></p>
      {invoicePath && <Button type="button" disabled={pending} onClick={openInvoiceFile} className="w-fit" variant="secondary">Ver factura</Button>}
      <Button type="button" disabled={pending} onClick={openInvoice} className="w-fit" variant="secondary">Corregir factura</Button>
    </div>}
    {status === "en_revision" && <form action={(data) => void run(() => transitionJob({ jobId, newStatus: "asignado", reason: String(data.get("reason") ?? "") }))} className="flex flex-col gap-3 sm:flex-row"><label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Motivo de devolución<input name="reason" required className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><Button disabled={pending} className="self-end" variant="secondary">Devolver a corrección</Button></form>}
    {canArchive && (archived ? <Button type="button" disabled={pending} onClick={() => run(() => setJobArchived({ jobId, archived: false }))} className="w-fit" variant="secondary">Restaurar trabajo</Button> : <form action={(data) => void run(() => setJobArchived({ jobId, archived: true, reasonCode: String(data.get("archiveReasonCode") ?? ""), notes: String(data.get("archiveNotes") ?? "") }))} className="grid gap-3 border-t border-line pt-4"><label className="grid gap-1 text-sm font-medium text-ink-soft">Motivo para retirar del dashboard<select name="archiveReasonCode" required defaultValue="" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"><option value="" disabled>Selecciona un motivo</option><option value="duplicate_job">Trabajo duplicado</option><option value="cancelled_by_client_or_office">Cancelado por el cliente o la oficina</option><option value="incorrect_address_or_data">Dirección o datos incorrectos</option><option value="no_access_or_blocked_conditions">Sin acceso o condiciones que impiden realizarlo</option><option value="out_of_scope">Fuera de alcance o no corresponde a Susotech</option></select></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Observaciones (opcional)<textarea name="archiveNotes" maxLength={2000} rows={3} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><Button disabled={pending} className="w-fit" variant="secondary">Archivar trabajo</Button></form>)}
    <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p>
    {invoiceOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-brand-950/40 p-4"><form action={() => void submitInvoice()} className="grid w-full max-w-md gap-3 rounded-2xl border border-line bg-white p-6 text-ink shadow-card"><h2 className="text-xl font-bold text-ink">{status === "aprobado" ? "Facturar trabajo" : "Corregir factura"}</h2><label className="grid gap-1 text-sm font-medium text-ink-soft">Número de factura<input name="invoiceNumber" value={invoiceValue} onChange={(event) => setInvoiceValue(event.target.value)} required maxLength={200} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><label className="grid gap-1 text-sm font-medium text-ink-soft">Adjuntar factura (opcional)<input type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" onChange={(event) => setInvoiceFile(event.target.files?.[0] ?? null)} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label><p className="text-xs text-ink-soft">El documento se guarda en el almacenamiento privado del trabajo. Podés facturar sin adjuntar nada.</p><div className="flex gap-2"><Button disabled={pending} variant="primary">{pending ? "Procesando…" : status === "aprobado" ? "Facturar" : "Guardar corrección"}</Button><Button type="button" disabled={pending} variant="secondary" onClick={() => setInvoiceOpen(false)}>Cancelar</Button></div></form></div>}
  </section>;
}
