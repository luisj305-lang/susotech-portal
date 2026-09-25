import type { ReactNode } from "react";
import { AppShell } from "@/components/dashboard/app-shell";
import { Card } from "@/components/ui/card";
import type { CurrentProfile } from "@/lib/auth/session";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { RECRUITMENT_STATUS_LABELS } from "@/lib/recruitment/types";

export const recruitmentStatusLabels = RECRUITMENT_STATUS_LABELS;

const statusColors = {
  new: "bg-blue-50 text-blue-800",
  contacted: "bg-cyan-50 text-cyan-800",
  interview: "bg-amber-50 text-amber-800",
  hired: "bg-emerald-50 text-emerald-800",
  rejected: "bg-slate-100 text-slate-700",
};

export const recruitmentFieldClass = "w-full min-w-0 rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";

export function RecruitmentShell({ profile, children }: { profile: CurrentProfile; children: ReactNode }) {
  return <AppShell role={profile.role as "admin" | "supervisor"} userName={displayName(profile)} roleLabel={roleLabel(profile.role)} initials={initials(profile)} presentation="admin-dashboard">
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
  </AppShell>;
}

export function RecruitmentStatus({ status }: { status: keyof typeof recruitmentStatusLabels }) {
  return <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${statusColors[status]}`}>{recruitmentStatusLabels[status]}</span>;
}

export function RecruitmentSection({ title, children }: { title: string; children: ReactNode }) {
  return <Card className="p-5 sm:p-6"><h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>{children}</Card>;
}

export function RecruitmentField({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0"><dt className="text-sm text-ink-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-ink">{value || "No indicado"}</dd></div>;
}

export function recruitmentDate(value: string) {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}
