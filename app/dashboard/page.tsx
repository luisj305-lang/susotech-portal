import { DashboardClient } from "@/components/dashboard-client";
import { requireProfile } from "@/lib/auth/session";

export default async function DashboardPage() {
  const profile = await requireProfile();
  return <DashboardClient profile={profile} />;
}
