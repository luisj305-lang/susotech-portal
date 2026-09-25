"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { closeMyHourlyShift } from "@/lib/work-shifts/actions";
import { formatMoney } from "@/lib/dashboard/format";
import type { HourlyPayrollSummary } from "@/lib/work-shifts/types";

const timePattern = /^\d{2}:\d{2}$/;

const periodDateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
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

function currentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function PayPeriodStatusBadge({ status }: { status: "pending" | "approved" }) {
  const approved = status === "approved";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: approved ? "#f0fdf4" : "#fffbeb",
        color: approved ? "#166534" : "#92400e",
      }}
    >
      <span
        style={{
          width: "0.5rem",
          height: "0.5rem",
          borderRadius: "9999px",
          backgroundColor: approved ? "#22c55e" : "#f59e0b",
        }}
      />
      {approved ? "Aprobado" : "Pendiente"}
    </span>
  );
}

export function HourlyShiftPanel({ summary }: { summary: HourlyPayrollSummary }) {
  const router = useRouter();
  const [finishedTime, setFinishedTime] = useState(currentTime);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!summary.isHourly) return null;

  const submit = () => {
    const openShift = summary.openShift;
    if (!openShift) return;
    if (!timePattern.test(finishedTime)) {
      setMessage("Selecciona una hora de finalización válida.");
      return;
    }
    startTransition(async () => {
      setMessage("");
      setSuccess(false);
      try {
        const result = await closeMyHourlyShift({
          finishedAt: `${openShift.work_date}T${finishedTime}`,
        });
        setMessage(result.message);
        if (result.success) {
          setSuccess(true);
          router.refresh();
        }
      } catch {
        setMessage("No se pudo cerrar la jornada. Intenta nuevamente.");
      }
    });
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-ink-muted">
        Pago por horas
      </p>
      <h2 className="mt-2 text-xl font-bold text-ink">Jornada por horas</h2>

      <div className="mt-4 grid gap-1 text-sm text-ink-soft sm:grid-cols-2">
        <p>
          Horas del período: <strong className="text-ink">{formatMinutes(summary.settledPayableMinutes)}</strong>
        </p>
        <p>
          Pago del período: <strong className="text-ink">{formatMoney(summary.settledPayableCents / 100)}</strong>
        </p>
      </div>

      {summary.provisionalActiveEstimate && (
        <p className="mt-3 rounded-xl bg-surface-muted p-3 text-sm text-ink-soft">
          Estimación provisional de la jornada en curso:{" "}
          <strong className="text-ink">{formatMinutes(summary.provisionalActiveEstimate.elapsedMinutes)}</strong>{" "}
          · aprox. {formatMoney(summary.provisionalActiveEstimate.payableCents / 100)}
        </p>
      )}

      {summary.openShift && (
        <div className="mt-4 border-t border-line pt-5">
          <h3 className="text-lg font-bold text-ink">Cerrar jornada</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Registra la hora de finalización. Puede ser anterior a la hora actual,
            pero no anterior al inicio de la jornada y con un máximo de 14 horas.
          </p>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-ink-soft">
              Hora de finalización
              <input
                type="time"
                value={finishedTime}
                onChange={(event) => {
                  setFinishedTime(event.target.value);
                  setMessage("");
                }}
                disabled={pending}
                className="min-h-12 rounded-xl border border-line-strong bg-white px-4 text-ink outline-none focus:border-accent-500"
              />
            </label>
            <Button
              type="button"
              variant="primary"
              disabled={pending}
              onClick={submit}
              className="min-h-12 w-full"
            >
              {pending ? "Cerrando…" : "Cerrar jornada"}
            </Button>
          </div>
          <p
            role="status"
            aria-live="polite"
            className={`mt-3 min-h-6 text-sm ${success ? "font-semibold text-ink" : "text-ink-soft"}`}
          >
            {message}
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-5">
        <h3 className="text-lg font-bold text-ink">Historial de períodos</h3>
        {summary.history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Aún no hay períodos registrados.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {summary.history.map((record) => (
              <li
                key={record.period_start}
                className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {formatPeriodRange(record.period_start, record.period_end_exclusive)}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {formatMoney(record.total_payable_cents / 100)}
                  </p>
                </div>
                <PayPeriodStatusBadge status={record.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
