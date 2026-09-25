import { AppShell } from "@/components/dashboard/app-shell";
import { TechnicianAppShell } from "@/components/dashboard/technician-app-shell";
import {
  ManualJobsManager,
} from "@/components/manual-jobs/manual-jobs-manager";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireProfile } from "@/lib/auth/session";
import { getManualJobCreationContext, getMyManualJobs, getOfficeManualJobs } from "@/lib/manual-jobs/queries";

export default async function ManualJobsPage() {
  const profile = await requireProfile();
  const creationContext = profile.role === "auditor" ? undefined : await getManualJobCreationContext();

  if (profile.role === "tecnico") {
    const initialJobs = await getMyManualJobs();

    return (
      <TechnicianAppShell userName={displayName(profile)}>
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <ManualJobsManager
            role="tecnico"
            currentUserId={profile.id}
            initialJobs={initialJobs}
            creationContext={creationContext}
          />
        </div>
      </TechnicianAppShell>
    );
  }

  const initialJobs = await getOfficeManualJobs();

  return (
    <AppShell
      role={profile.role as "admin" | "supervisor"}
      userName={displayName(profile)}
      roleLabel={roleLabel(profile.role)}
      initials={initials(profile)}
    >
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <ManualJobsManager
          role={profile.role as "admin" | "supervisor" | "auditor"}
          currentUserId={profile.id}
          initialJobs={initialJobs}
          creationContext={creationContext}
        />
      </div>
    </AppShell>
  );
}
