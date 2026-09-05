import type { ReactNode } from "react";
import { NotificationsBell } from "./notifications-bell";
import { cn } from "@/lib/utils";
import type { AdminDashboardPresentation } from "./admin-dashboard-presentation";

export function Topbar({
  menuButton,
  userName,
  roleLabel,
  initials,
  presentation = "default",
}: {
  menuButton?: ReactNode;
  userName: string;
  roleLabel: string;
  initials: string;
  presentation?: AdminDashboardPresentation;
}) {
  return (
    <header
      className={cn(
        "flex items-center justify-between border-b border-line bg-white px-4 py-2 sm:px-6",
        presentation === "admin-dashboard" ? "min-h-[4.5rem]" : "min-h-[4rem]",
      )}
    >
      <div className="flex items-center gap-3">{menuButton}</div>
      <div className="flex items-center gap-3">
        <NotificationsBell presentation={presentation} />
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand-900 text-sm font-semibold text-white shadow-[var(--shadow-control)]">
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-tight text-ink">
              {userName}
            </p>
            <p className="text-xs leading-tight text-ink-muted">{roleLabel}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
