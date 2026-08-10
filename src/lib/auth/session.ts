import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "supervisor" | "tecnico";

export type CurrentProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
};

export const requireProfile = cache(async (): Promise<CurrentProfile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/acceso-denegado");
  }

  if (!profile.is_active) {
    redirect("/acceso-denegado");
  }

  return profile as CurrentProfile;
});

export async function requireRole(role: UserRole) {
  const profile = await requireProfile();

  if (profile.role !== role) {
    redirect("/acceso-denegado");
  }

  return profile;
}

export async function requireAdmin() {
  return requireRole("admin");
}

export async function requireSupervisor() {
  const profile = await requireProfile();

  return profile.role === "admin" ? profile : requireRole("supervisor");
}
