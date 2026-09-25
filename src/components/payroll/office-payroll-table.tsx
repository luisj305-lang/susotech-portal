"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/dashboard/format";
import {
  approveHourlyPayPeriodAction,
  correctHourlyShiftAction,
} from "@/lib/payroll/actions";
import type {
  OfficeHourlyPayroll,
  OfficeHourlyShiftRow,
  OfficeHourlyTechnician,
} from "@/lib/payroll/types";

const timePattern = /^\d{2}:\d{2}$/;

const periodDateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  timeZone: "America/New_York",
});

const shiftDateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/New_York",
});

const timeOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/New_York",
});

function civilDateAtNoon(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatPeriodRange(periodStart: string, periodEndExclusive: string): string {
  const end = civilDateAtNoon(periodEndExclusive);
  end.setUTCDate(end.getUTCDate() - 1);
  return `${periodDateFormatter.format(civilDateAtNoon(periodStart))} — ${periodDateFormatter.format(end)}`;
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function formatShiftTime(iso: string | null): string {
  if (!iso) return "—";
  return shiftDateTimeFormatter.format(new Date(iso));
}

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const parts = timeOnlyFormatter.formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function settlementKindLabel(kind: "self" | "auto" | null): string {
  if (kind === "self") return "Manual";
  if (kind === "auto") return "Automático";
  return "—";
}

function payPeriodBadgeStatus(status: "pending" | "approved"): string {
  // `aprobado` renders green "Aprobado"; `pdf_pending` renders amber "Pendiente".
  return status === "approved" ? "aprobado" : "pdf_pending";
}

export function OfficePayrollTable({
  isAdmin,
  data,
  weekOffset,
}: {
  isAdmin: boolean;
  data: OfficeHourlyPayroll;
  weekOffset: number;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [correctingShift, setCorrectingShift] =
    useState<OfficeHourlyShiftRow | null>(null);
  const [finishedTime, setFinishedTime] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const approve = (tech: OfficeHourlyTechnician) => {
    if (
      !window.confirm(
        `¿Aprobar el período de ${tech.name}? La aprobación no se puede deshacer.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      setMessage("");
      const result = await approveHourlyPayPeriodAction({
        technicianId: tech.technicianId,
        periodStart: data.periodStart,
      });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  };

  const openCorrection = (shift: OfficeHourlyShiftRow) => {
    setCorrectingShift(shift);
    setFinishedTime(timeOf(shift.finishedAt));
    setReason("");
    setMessage("");
  };

  const closeCorrection = () => {
    setCorrectingShift(null);
    setFinishedTime("");
    setReason("");
  };

  const submitCorrection = () => {
    if (!correctingShift) return;
    if (!timePattern.test(finishedTime)) {
      setMessage("Selecciona una hora de finalización válida.");
      return;
    }
    startTransition(async () => {
      setMessage("");
      const result = await correctHourlyShiftAction({
        shiftId: correctingShift.shiftId,
        finishedAt: `${correctingShift.workDate}T${finishedTime}`,
        reason: reason.trim() || null,
      });
      setMessage(result.message);
      if (result.success) {
        closeCorrection();
        router.refresh();
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">
          Finanzas
        </p>
        <h1 className="mt-1 text-3xl font-bold text-ink">Nómina por horas</h1>
        <p className="mt-2 text-ink-soft">
          Período: {formatPeriodRange(data.periodStart, data.periodEndExclusive)}.
          {data.isCurrentPeriod
            ? " Aprueba el pago por horas de cada técnico."
            : " Período anterior en solo lectura."}
        </p>
        <nav
          className="mt-3 flex items-center gap-2 text-sm font-medium"
          aria-label="Navegación de semana"
        >
          <Link
            href={`/nomina?week=${weekOffset - 1}`}
            className="text-accent-600 hover:text-accent-500"
          >
            ← Semana anterior
          </Link>
          {weekOffset !== 0 ? (
            <>
              <span className="text-ink-muted" aria-hidden="true">
                ·
              </span>
              <Link
                href="/nomina"
                className="text-accent-600 hover:text-accent-500"
              >
                Semana actual
              </Link>
            </>
          ) : null}
          <span className="text-ink-muted" aria-hidden="true">
            ·
          </span>
          <Link
            href={`/nomina?week=${weekOffset + 1}`}
            className="text-accent-600 hover:text-accent-500"
          >
            Semana siguiente →
          </Link>
        </nav>
      </header>

      {message && (
        <p role="status" className="mb-4 mt-4 text-sm font-medium text-ink-soft">
          {message}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-3 text-left font-semibold">Técnico</th>
              <th className="px-4 py-3 text-left font-semibold">
                Horas del período
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                Total a pagar
              </th>
              <th className="px-4 py-3 text-left font-semibold">Estado</th>
              <th className="px-4 py-3 text-left font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data.technicians.map((tech) => {
              const approved = tech.periodStatus === "approved";
              const expanded = expandedId === tech.technicianId;
              const canCorrect = isAdmin && !approved && data.isCurrentPeriod;

              return (
                <FragmentRow
                  key={tech.technicianId}
                  tech={tech}
                  expanded={expanded}
                  canCorrect={canCorrect}
                  isCurrentPeriod={data.isCurrentPeriod}
                  correctingShift={correctingShift}
                  finishedTime={finishedTime}
                  reason={reason}
                  pending={pending}
                  onToggle={() =>
                    setExpandedId((current) =>
                      current === tech.technicianId ? null : tech.technicianId,
                    )
                  }
                  onApprove={() => approve(tech)}
                  onOpenCorrection={openCorrection}
                  onCloseCorrection={closeCorrection}
                  onFinishedTimeChange={setFinishedTime}
                  onReasonChange={setReason}
                  onSubmitCorrection={submitCorrection}
                />
              );
            })}
          </tbody>
        </table>
        {data.technicians.length === 0 && (
          <p className="p-8 text-center text-ink-muted">
            No hay técnicos por horas en este período.
          </p>
        )}
      </div>
    </div>
  );
}

function FragmentRow({
  tech,
  expanded,
  canCorrect,
  isCurrentPeriod,
  correctingShift,
  finishedTime,
  reason,
  pending,
  onToggle,
  onApprove,
  onOpenCorrection,
  onCloseCorrection,
  onFinishedTimeChange,
  onReasonChange,
  onSubmitCorrection,
}: {
  tech: OfficeHourlyTechnician;
  expanded: boolean;
  canCorrect: boolean;
  isCurrentPeriod: boolean;
  correctingShift: OfficeHourlyShiftRow | null;
  finishedTime: string;
  reason: string;
  pending: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onOpenCorrection: (shift: OfficeHourlyShiftRow) => void;
  onCloseCorrection: () => void;
  onFinishedTimeChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSubmitCorrection: () => void;
}) {
  const approved = tech.periodStatus === "approved";

  return (
    <>
      <tr className="border-t border-line">
        <td className="px-4 py-3 text-ink-soft">{tech.name}</td>
        <td className="px-4 py-3 text-ink-soft">
          {formatMinutes(tech.settledMinutes)}
        </td>
        <td className="px-4 py-3 text-right font-semibold text-ink">
          {formatMoney(tech.periodTotalPayableCents / 100)}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={payPeriodBadgeStatus(tech.periodStatus)} />
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-2">
            {isCurrentPeriod && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={approved || pending}
                onClick={onApprove}
              >
                {approved ? "Aprobado" : "Aprobar"}
              </Button>
            )}
            {tech.periodRecordExists && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onToggle}
              >
                {expanded ? "Ocultar detalle" : "Ver detalle"}
              </Button>
            )}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-t border-line bg-surface-muted/40">
          <td colSpan={5} className="px-4 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Jornadas del período
            </p>
            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                    <th className="px-3 py-2 text-left font-semibold">Inicio</th>
                    <th className="px-3 py-2 text-left font-semibold">Cierre</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Minutos pagables
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      Importe
                    </th>
                    {canCorrect && (
                      <th className="px-3 py-2 text-left font-semibold">
                        Corrección
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tech.shifts.map((shift) => {
                    const correcting = correctingShift?.shiftId === shift.shiftId;
                    const settled = shift.settledAt !== null;
                    return (
                      <tr key={shift.shiftId} className="border-t border-line">
                        <td className="px-3 py-2 text-ink-soft">
                          {shift.workDate}
                        </td>
                        <td className="px-3 py-2 text-ink-soft">
                          {formatShiftTime(shift.startedAt)}
                        </td>
                        <td className="px-3 py-2 text-ink-soft">
                          {shift.settlementKind === "auto"
                            ? "Automático"
                            : formatShiftTime(shift.finishedAt)}
                          <span className="ml-1 text-xs text-ink-muted">
                            ({settlementKindLabel(shift.settlementKind)})
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-soft">
                          {shift.payableMinutes != null
                            ? formatMinutes(Number(shift.payableMinutes))
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-ink-soft">
                          {shift.payableCents != null
                            ? formatMoney(Number(shift.payableCents) / 100)
                            : "—"}
                        </td>
                        {canCorrect && (
                          <td className="px-3 py-2">
                            {settled ? (
                              correcting ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="time"
                                    aria-label={`Hora de cierre de la jornada del ${shift.workDate}`}
                                    value={finishedTime}
                                    disabled={pending}
                                    onChange={(event) =>
                                      onFinishedTimeChange(event.target.value)
                                    }
                                    className="rounded-xl border border-line bg-white px-2 py-1.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
                                  />
                                  <input
                                    type="text"
                                    placeholder="Motivo (opcional)"
                                    value={reason}
                                    disabled={pending}
                                    onChange={(event) =>
                                      onReasonChange(event.target.value)
                                    }
                                    className="w-40 rounded-xl border border-line bg-white px-2 py-1.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
                                  />
                                  <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    disabled={pending}
                                    onClick={onSubmitCorrection}
                                  >
                                    {pending ? "Guardando..." : "Guardar"}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={pending}
                                    onClick={onCloseCorrection}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={pending}
                                  onClick={() => onOpenCorrection(shift)}
                                >
                                  Corregir
                                </Button>
                              )
                            ) : (
                              <span className="text-xs text-ink-muted">
                                En curso
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {tech.shifts.length === 0 && (
                    <tr className="border-t border-line">
                      <td
                        colSpan={canCorrect ? 6 : 5}
                        className="px-3 py-4 text-center text-ink-muted"
                      >
                        No hay jornadas registradas en este período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
