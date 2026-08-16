import Link from "next/link";
import { JobForm } from "@/components/jobs/job-form";
import { AppShell } from "@/components/dashboard/app-shell";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireSupervisor } from "@/lib/auth/session";

export default async function NewJobPage() {
  const profile = await requireSupervisor();
  return (
    <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)}>
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/trabajos" className="text-sm font-medium text-accent-600 hover:text-accent-500">← Trabajos</Link>
        <h1 className="text-3xl font-bold text-ink">Nuevo trabajo</h1>
        <JobForm />
      </div>
    </AppShell>
  );
}
