import type { ReactNode } from "react";
import { NotificationsBell } from "./notifications-bell";

export function Topbar({
  menuButton,
  userName,
  roleLabel,
  initials,
}: {
  menuButton?: ReactNode;
  userName: string;
  roleLabel: string;
  initials: string;
}) {
  return (
    <header className="flex min-h-[4rem] items-center justify-between border-b border-line bg-white px-4 py-2 sm:px-6">
      <div className="flex items-center gap-3">{menuButton}</div>
      <div className="flex items-center gap-3">
        <NotificationsBell />
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
