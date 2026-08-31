import Link from "next/link";
import type { ActiveWorkShift } from "@/lib/work-shifts/types";
import { buttonClasses } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const dateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

function formatRemaining(remainingMs: number): string {
  if (remainingMs < 0) return "Jornada por vencer";
  if (remainingMs < 60_000) return "menos de 1 min";
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min restantes`;
  return `${hours} h ${minutes} min restantes`;
}

export function ShiftStatusCard({
  shift,
  active,
}: {
  shift: ActiveWorkShift | null;
  active: boolean;
}) {
  if (!active || !shift) {
    return (
      <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
        <h2 className="text-xl font-bold text-ink">Jornada inactiva</h2>
        <p className="mt-2 text-ink-soft">
          Debes iniciar tu jornada para acceder y operar trabajos.
        </p>
        <Link
          href="/jornada/iniciar"
          className={`${buttonClasses({ variant: "primary", size: "lg" })} mt-4 w-full`}
        >
          Iniciar jornada
        </Link>
      </section>
    );
  }

  const startedAt = new Date(shift.started_at).getTime();
  const activeUntil = new Date(shift.active_until).getTime();
  const serverNow = new Date(shift.server_now).getTime();
  const remainingMs = activeUntil - serverNow;

  const totalSpan = activeUntil - startedAt;
  const elapsed = serverNow - startedAt;
  const rawFraction = totalSpan > 0 ? elapsed / totalSpan : 0;
  const fraction = Math.min(1, Math.max(0, rawFraction));

  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">Tu jornada</h2>
        <StatusBadge status="activo" />
      </div>
      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Iniciada</dt>
          <dd className="font-semibold text-ink">{dateTimeFormatter.format(new Date(shift.started_at))}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Vence</dt>
          <dd className="font-semibold text-ink">{dateTimeFormatter.format(new Date(shift.active_until))}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Camión</dt>
          <dd className="font-semibold text-ink">{shift.vehicle_unit_number ?? "Sin camión asignado"}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <div className="h-2 rounded-full bg-surface-muted" aria-hidden="true">
          <div
            className="h-2 rounded-full bg-brand-900"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <p className="mt-2 text-sm font-medium text-ink-soft">
          {formatRemaining(remainingMs)}
        </p>
      </div>
      <Link
        href="/dashboard"
        className={`${buttonClasses({ variant: "secondary", size: "md" })} mt-4`}
      >
        Ver mi jornada
      </Link>
    </section>
  );
}
