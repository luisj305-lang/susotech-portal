import type { CurrentProfile, UserRole } from "@/lib/auth/session";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  tecnico: "Técnico",
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

export function emailLocal(profile: CurrentProfile): string {
  return profile.email.split("@")[0] || profile.email;
}

export function displayName(profile: CurrentProfile): string {
  return profile.full_name || emailLocal(profile);
}

export function firstName(profile: CurrentProfile): string {
  return profile.full_name?.trim().split(/\s+/)[0] || emailLocal(profile);
}

export function initials(profile: CurrentProfile): string {
  if (profile.full_name) {
    const parts = profile.full_name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
  }
  return (profile.email[0] ?? "").toUpperCase();
}
