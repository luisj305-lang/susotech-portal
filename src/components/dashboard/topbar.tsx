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
    <header className="flex h-16 items-center justify-between border-b border-line bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">{menuButton}</div>
      <div className="flex items-center gap-3">
        <NotificationsBell />
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-900 text-sm font-semibold text-white">
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
