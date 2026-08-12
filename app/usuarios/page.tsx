import { UsersManager } from "@/components/users-manager";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage() {
  const currentProfile = await requireAdmin();
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, technician_type")
    .order("full_name");

  if (error) {
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
    <UsersManager
      currentUserId={currentProfile.id}
      initialUsers={(users ?? []).map((user) => ({ ...user, crew_names: crewNames.get(user.id) ?? [] }))}
    />
  );
}
