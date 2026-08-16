import Link from "next/link";
import { BulkImport } from "@/components/jobs/bulk-import";
import { AppShell } from "@/components/dashboard/app-shell";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireSupervisor } from "@/lib/auth/session";
import { listAssigneeOptions } from "@/lib/jobs/queries";

export default async function ImportJobsPage() {
  const profile = await requireSupervisor();
  const options = await listAssigneeOptions();
  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/trabajos" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Trabajos</Link>
        <header>
          <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Importación masiva</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Importar órdenes PDF</h1>
          <p className="mt-2 max-w-3xl text-ink-soft">Revisa los datos detectados, corrige lo necesario y confirma la asignación. Un archivo con error no detiene a los demás.</p>
        </header>
        <BulkImport options={options} />
      </div>
    </AppShell>
  );
}
