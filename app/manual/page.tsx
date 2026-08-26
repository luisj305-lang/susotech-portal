import { AppShell } from "@/components/dashboard/app-shell";
import { TechnicianAppShell } from "@/components/dashboard/technician-app-shell";
import {
  ManualJobsManager,
  type ManualJob,
} from "@/components/manual-jobs/manual-jobs-manager";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function ManualJobsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  if (profile.role === "tecnico") {
    const { data, error } = await supabase.rpc("list_my_manual_jobs");
    if (error) throw new Error("No se pudieron cargar los trabajos manuales.");
    const initialJobs = (data ?? []) as ManualJob[];

    return (
      <TechnicianAppShell userName={displayName(profile)}>
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <ManualJobsManager
            role="tecnico"
            currentUserId={profile.id}
            initialJobs={initialJobs}
          />
        </div>
      </TechnicianAppShell>
    );
  }

  const { data, error } = await supabase.rpc("list_manual_jobs_for_office");
  if (error) throw new Error("No se pudieron cargar los trabajos manuales.");
  const initialJobs = (data ?? []) as ManualJob[];

  return (
    <AppShell
      role={profile.role as "admin" | "supervisor"}
      userName={displayName(profile)}
      roleLabel={roleLabel(profile.role)}
      initials={initials(profile)}
    >
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <ManualJobsManager
          role={profile.role as "admin" | "supervisor"}
          currentUserId={profile.id}
          initialJobs={initialJobs}
        />
      </div>
    </AppShell>
  );
}
