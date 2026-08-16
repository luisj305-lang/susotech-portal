import Link from "next/link";
import type { CurrentProfile } from "@/lib/auth/session";
import type { OfficeJobPreview, WorkerOperationsRow } from "@/lib/jobs/types";
import { AppShell } from "./app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { StatCards } from "./stat-cards";
import { WorkerActivityTable } from "./worker-activity-table";
import { QuickActions } from "./quick-actions";
import { PendingReview } from "./pending-review";
import { formatWeekRange } from "@/lib/dashboard/format";

const roleLabels = {
  admin: "Administrador",
  supervisor: "Supervisor",
  tecnico: "Técnico",
} as const;

function computeGreeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function fallbackReferenceDate(weekOffset: number): Date {
  return new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000);
}

function initialsFor(fullName: string | null, email: string): string {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    if (parts.length === 1) return parts[0][0].toUpperCase();
  }
  return (email[0] ?? "").toUpperCase();
}

export function AdminDashboard({
  profile,
  workerOperations,
  pendingReview,
  weekOffset,
}: {
  profile: CurrentProfile;
  workerOperations: WorkerOperationsRow[];
  pendingReview: OfficeJobPreview[];
  weekOffset: number;
}) {
  const role = profile.role as "admin" | "supervisor";
  const emailLocal = profile.email.split("@")[0] ?? profile.email;
  const displayName = profile.full_name || emailLocal;
  const firstName = profile.full_name?.trim().split(/\s+/)[0] || emailLocal;
  const initials = initialsFor(profile.full_name, profile.email);
  const roleLabel = roleLabels[profile.role];

  const weekLabel = formatWeekRange(
    workerOperations[0]?.week_start_at,
    workerOperations[0]?.week_end_exclusive_at,
    fallbackReferenceDate(weekOffset),
  );

  const weekControls = (
    <nav
      className="flex items-center gap-2 text-sm font-medium"
      aria-label="Navegación de semana"
    >
      <Link
        href={`/dashboard?week=${weekOffset - 1}`}
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
            href="/dashboard"
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
        href={`/dashboard?week=${weekOffset + 1}`}
        className="text-accent-600 hover:text-accent-500"
      >
        Semana siguiente →
      </Link>
    </nav>
  );

  return (
    <AppShell
      role={role}
      userName={displayName}
      roleLabel={roleLabel}
      initials={initials}
    >
      <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
        <PageHeader
          greeting={`${computeGreeting()}, ${firstName}`}
          title="Resumen operativo de esta semana"
          description="Consulta el estado de los técnicos, la producción y la gasolina de la semana en curso."
          weekLabel={`Semana: ${weekLabel}`}
          weekControls={weekControls}
        />
        <StatCards rows={workerOperations} />
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <WorkerActivityTable rows={workerOperations} />
          </div>
          <div className="space-y-6">
            <QuickActions role={role} />
            <PendingReview jobs={pendingReview} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
