import { UsersManager } from "@/components/users-manager";
import { AppShell } from "@/components/dashboard/app-shell";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import type { WorkerSpecialty } from "@/lib/auth/capabilities";
import { requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage() {
  const currentProfile = await requireSupervisor();
  const supabase = await createClient();
  const [{ data: users, error }, { data: priceCategories, error: categoriesError }] = await Promise.all([
    supabase.rpc("list_profiles_for_office"),
    supabase.from("price_categories").select("id, slug, name").eq("active", true).order("name"),
  ]);

  if (error || categoriesError) {
    throw new Error("No se pudo cargar la lista de usuarios.");
  }

  const { data: crews, error: crewsError } = await supabase
    .from("crews")
    .select("name, crew_members(technician_id)")
    .order("name");

  if (crewsError) {
    throw new Error("No se pudo cargar la membresía de equipos.");
  }

  const crewNames = new Map<string, string[]>();
  for (const crew of crews ?? []) {
    for (const member of crew.crew_members ?? []) {
      const names = crewNames.get(member.technician_id) ?? [];
      names.push(crew.name);
      crewNames.set(member.technician_id, names);
    }
  }

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
          role: "admin" | "supervisor" | "tecnico";
          is_active: boolean;
          worker_specialty: WorkerSpecialty | null;
          price_category_id: string | null;
          price_category_name: string | null;
        }) => ({ ...user, crew_names: crewNames.get(user.id) ?? [] }))}
      />
    </AppShell>
  );
}
