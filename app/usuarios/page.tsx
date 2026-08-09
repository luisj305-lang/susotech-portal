import { UsersManager } from "@/components/users-manager";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage() {
  const currentProfile = await requireAdmin();
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .order("full_name");

  if (error) {
    throw new Error("No se pudo cargar la lista de usuarios.");
  }

  return (
    <UsersManager
      currentUserId={currentProfile.id}
      initialUsers={users ?? []}
    />
  );
}
