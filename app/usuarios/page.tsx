import { UsersManager } from "@/components/users-manager";
import { AppShell } from "@/components/dashboard/app-shell";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import type { WorkerSpecialty } from "@/lib/auth/capabilities";
import { requireOfficeViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage() {
  const currentProfile = await requireOfficeViewer();
  const supabase = await createClient();
  const [
    { data: users, error },
    { data: priceCategories, error: categoriesError },
    { data: compensation, error: compensationError },
  ] = await Promise.all([
    supabase.rpc("list_profiles_for_office"),
    supabase
      .from("price_categories")
      .select("id, slug, name")
      .eq("active", true)
      .eq("technician_assignable", true)
      .order("name"),
    supabase
      .from("technician_compensation_settings")
      .select("technician_id, mode, hourly_rate_cents"),
  ]);

  if (error || categoriesError || compensationError) {
    throw new Error("No se pudo cargar la lista de usuarios.");
  }

  const compensationByTech = new Map<
    string,
    { mode: "percentage" | "hourly"; hourly_rate_cents: number | null }
  >(
    ((compensation ?? []) as Array<{
      technician_id: string;
      mode: "percentage" | "hourly";
      hourly_rate_cents: number | null;
    }>).map((item) => [
      item.technician_id,
      { mode: item.mode, hourly_rate_cents: item.hourly_rate_cents },
    ]),
  );

  return (
    <AppShell role={currentProfile.role as "admin" | "supervisor"} userName={displayName(currentProfile)} roleLabel={roleLabel(currentProfile.role)} initials={initials(currentProfile)}>
      <UsersManager
        currentUserId={currentProfile.id}
        canManage={currentProfile.role === "admin"}
        priceCategories={priceCategories ?? []}
        initialUsers={(users ?? []).map((user: {
          id: string;
          email: string;
          full_name: string | null;
          role: "admin" | "supervisor" | "tecnico" | "auditor";
          is_active: boolean;
          worker_specialty: WorkerSpecialty | null;
          price_category_id: string | null;
          price_category_name: string | null;
          phone: string | null;
        }) => {
          const settings = compensationByTech.get(user.id);
          return {
            ...user,
            compensation_mode: settings?.mode ?? null,
            hourly_rate_cents: settings?.hourly_rate_cents ?? null,
          };
        })}
      />
    </AppShell>
  );
}
