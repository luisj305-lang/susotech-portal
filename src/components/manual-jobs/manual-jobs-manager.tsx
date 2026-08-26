"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconClipboardCheck } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/dashboard/format";
import { createManualJob, createManualJobPdfUrl, reviewManualJob } from "@/lib/manual-jobs/actions";

export type ManualJobWorker = {
  technicianId: string;
  name: string;
  percentageBasisPoints: number;
};

export type ManualJob = {
  id: string;
  prism_number: string;
  value_cents: number;
  status: "pending" | "approved" | "rejected";
  creator_name?: string | null;
  created_at: string;
  workers: ManualJobWorker[];
  rejection_reason?: string | null;
  pdf_path?: string | null;
};

type Participant = { id: string; label: string; worker_specialty: string | null };

const STATUS_LABELS: Record<ManualJob["status"], string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
};

const STATUS_CLASSES: Record<ManualJob["status"], string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function ManualStatusBadge({ status }: { status: ManualJob["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const inputClasses =
  "rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none";

function formatPercentage(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

type WorkerRow = { technicianId: string; percentage: string };

export function ManualJobsManager({
  role,
  currentUserId,
  initialJobs,
}: {
  role: "tecnico" | "admin" | "supervisor";
  currentUserId: string;
  initialJobs: ManualJob[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [prism, setPrism] = useState("");
  const [value, setValue] = useState("");
  const [rows, setRows] = useState<WorkerRow[]>([{ technicianId: "", percentage: "" }]);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc("list_delivery_allocation_participants");
      if (!error) setParticipants((data ?? []) as Participant[]);
    })();
  }, []);

  const totalBasisPoints = rows.reduce(
    (sum, row) => sum + (Number(row.percentage) > 0 ? Math.round(Number(row.percentage) * 100) : 0),
    0,
  );

  const updateRow = (index: number, patch: Partial<WorkerRow>) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => setRows((current) => [...current, { technicianId: "", percentage: "" }]);
  const removeRow = (index: number) =>
    setRows((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));

  const submit = () => {
    setMessage("");
    if (!prism.trim()) {
      setMessage("El número de PRISM es obligatorio.");
      return;
    }
    const dollars = Number(value);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setMessage("Ingresa un valor mayor que cero.");
      return;
    }
    const validRows = rows.filter((row) => row.technicianId);
    if (validRows.length === 0) {
      setMessage("Agrega al menos un trabajador.");
      return;
    }
    if (rows.some((row) => !row.technicianId || Number(row.percentage) <= 0)) {
      setMessage("Completa el trabajador y su porcentaje en cada fila.");
      return;
    }
    if (totalBasisPoints !== 10000) {
      setMessage("Los porcentajes deben sumar exactamente 100.");
      return;
    }

    startTransition(async () => {
      const result = await createManualJob({
        prismNumber: prism.trim(),
        valueCents: Math.round(dollars * 100),
        workers: rows.map((row) => ({
          technicianId: row.technicianId,
          percentageBasisPoints: Math.round(Number(row.percentage) * 100),
        })),
      });
      setMessage(result.message);
      if (result.success) {
        setPrism("");
        setValue("");
        setRows([{ technicianId: "", percentage: "" }]);
        router.refresh();
      }
    });
  };

  const approve = (id: string) =>
    startTransition(async () => {
      const result = await reviewManualJob({ id, approve: true });
      setMessage(result.message);
      if (result.success) {
        setRejectTarget(null);
        router.refresh();
      }
    });

  const reject = (id: string) =>
    startTransition(async () => {
      const result = await reviewManualJob({ id, approve: false, reason: rejectReason });
      setMessage(result.message);
      if (result.success) {
        setRejectTarget(null);
        setRejectReason("");
        router.refresh();
      }
    });

  const openPdf = (id: string) =>
    startTransition(async () => {
      const result = await createManualJobPdfUrl({ id });
      if (result.success && result.signedUrl) {
        window.open(result.signedUrl, "_blank", "noopener,noreferrer");
      } else {
        setMessage(result.message);
      }
    });

  const isTechnician = role === "tecnico";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">
          Trabajo manual
        </p>
        <h1 className="mt-1 text-3xl font-bold text-ink">
          {isTechnician ? "Registrar trabajo manual" : "Trabajos manuales"}
        </h1>
        <p className="mt-2 text-ink-soft">
          {isTechnician
            ? "Registra un trabajo hecho fuera del flujo normal. Queda pendiente hasta que un administrador o supervisor lo apruebe."
            : "Aprobá o rechazá los trabajos manuales enviados por los técnicos."}
        </p>
      </header>

      {message ? (
        <p role="status" aria-live="polite" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-ink-soft">
          {message}
        </p>
      ) : null}

      {isTechnician ? (
        <section className="grid gap-6 rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-ink-soft">
              Número de PRISM
              <input
                type="text"
                autoComplete="off"
                value={prism}
                onChange={(event) => setPrism(event.target.value)}
                maxLength={100}
                placeholder="PRISM-000000"
                disabled={pending}
                className={inputClasses}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink-soft">
              Valor total (USD)
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0.00"
                disabled={pending}
                className={inputClasses}
              />
            </label>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-ink">Reparto entre trabajadores</p>
              <span
                className={`text-sm font-semibold ${
                  totalBasisPoints === 10000 ? "text-emerald-600" : "text-ink-muted"
                }`}
              >
                Total: {(totalBasisPoints / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%
              </span>
            </div>
            {rows.map((row, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-center">
                <select
                  value={row.technicianId}
                  onChange={(event) => updateRow(index, { technicianId: event.target.value })}
                  disabled={pending}
                  className={inputClasses}
                >
                  <option value="" disabled>
                    Selecciona un trabajador
                  </option>
                  {participants.map((participant) => (
                    <option key={participant.id} value={participant.id}>
                      {participant.label}
                    </option>
                  ))}
                </select>
                <label className="grid gap-1 text-sm font-medium text-ink-soft">
                  <span className="text-xs">Porcentaje</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={row.percentage}
                    onChange={(event) => updateRow(index, { percentage: event.target.value })}
                    placeholder="50"
                    disabled={pending}
                    className={inputClasses}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending || rows.length <= 1}
                  onClick={() => removeRow(index)}
                  className="sm:mt-5"
                >
                  Quitar
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={addRow} className="w-fit">
              Agregar trabajador
            </Button>
            <p className="text-xs text-ink-muted">
              Los porcentajes deben sumar exactamente 100. El valor total se reparte entre los trabajadores.
            </p>
          </div>

          <Button type="button" variant="primary" size="lg" disabled={pending} onClick={submit} className="w-full">
            {pending ? "Enviando…" : "Enviar trabajo manual"}
          </Button>
        </section>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-xl font-bold text-ink">
          {isTechnician ? "Mis trabajos manuales" : "Solicitudes"}
        </h2>
        {initialJobs.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white">
            <EmptyState
              icon={IconClipboardCheck}
              title="No hay trabajos manuales"
              description={
                isTechnician
                  ? "Los trabajos que registres aparecerán aquí."
                  : "Cuando un técnico registre un trabajo manual, aparecerá aquí para su revisión."
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            {initialJobs.map((job) => (
              <div key={job.id} className="rounded-2xl border border-line bg-white p-5 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      PRISM {job.prism_number}
                    </p>
                    <p className="text-lg font-bold text-ink">{formatMoney(job.value_cents / 100)}</p>
                    {!isTechnician && job.creator_name ? (
                      <p className="text-sm text-ink-soft">Creado por: {job.creator_name}</p>
                    ) : null}
                  </div>
                  <ManualStatusBadge status={job.status} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {job.workers.map((worker) => (
                    <span
                      key={worker.technicianId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-muted px-2.5 py-1 text-xs text-ink-soft"
                    >
                      {worker.name}
                      <span className="font-semibold text-ink">{formatPercentage(worker.percentageBasisPoints)}</span>
                    </span>
                  ))}
                </div>

                {!isTechnician && job.pdf_path ? (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => openPdf(job.id)}
                    >
                      Ver PDF
                    </Button>
                  </div>
                ) : null}

                {job.status === "rejected" && job.rejection_reason ? (
                  <p className="mt-3 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-ink-soft">
                    Motivo: {job.rejection_reason}
                  </p>
                ) : null}

                {!isTechnician && job.status === "pending" ? (
                  <div className="mt-4 border-t border-line pt-3">
                    {rejectTarget === job.id ? (
                      <div className="grid gap-2">
                        <label className="grid gap-1 text-sm font-medium text-ink-soft">
                          Motivo del rechazo (opcional)
                          <input
                            type="text"
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            maxLength={500}
                            disabled={pending}
                            className={inputClasses}
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => reject(job.id)}>
                            {pending ? "Procesando…" : "Confirmar rechazo"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => setRejectTarget(null)}
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="primary" size="sm" disabled={pending} onClick={() => approve(job.id)}>
                          Aprobar
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={pending}
                          onClick={() => {
                            setRejectTarget(job.id);
                            setRejectReason("");
                          }}
                        >
                          Rechazar
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
