"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { IconMenu, IconX } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { AdminDashboardPresentation } from "./admin-dashboard-presentation";

export function AppShell({
  role,
  userName,
  roleLabel,
  initials,
  children,
  presentation = "default",
}: {
  role: "admin" | "supervisor";
  userName: string;
  roleLabel: string;
  initials: string;
  children: ReactNode;
  presentation?: AdminDashboardPresentation;
}) {
  const [open, setOpen] = useState(false);
  const isAdmin = presentation === "admin-dashboard";

  return (
    <div className="flex min-h-screen bg-surface-muted">
      <aside
        className={cn(
          "hidden border-r lg:flex lg:shrink-0 lg:flex-col",
          isAdmin
            ? "border-white/10 bg-brand-950 lg:w-[13.5rem]"
            : "border-line bg-white lg:w-64",
        )}
      >
        <Sidebar role={role} userName={userName} presentation={presentation} />
      </aside>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-brand-950/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-[min(19rem,calc(100vw-var(--safe-area-right)))] flex-col pb-[var(--safe-area-bottom)] pt-[var(--safe-area-top)] shadow-2xl",
              isAdmin ? "bg-brand-950" : "bg-white",
            )}
          >
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={() => setOpen(false)}
              className={cn(
                "absolute right-3 top-[calc(var(--safe-area-top)+0.75rem)] z-10 flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border-0 bg-transparent",
                isAdmin
                  ? "text-brand-100 hover:bg-white/10"
                  : "text-ink-soft hover:bg-surface-muted",
              )}
            >
              <IconX className="h-5 w-5" />
            </button>
            <Sidebar role={role} userName={userName} presentation={presentation} />
          </aside>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col bg-surface-muted">
        <Topbar
          userName={userName}
          roleLabel={roleLabel}
          initials={initials}
          presentation={presentation}
          menuButton={
            <button
              type="button"
              aria-label="Abrir menú"
              onClick={() => setOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border-0 bg-transparent text-ink-soft hover:bg-surface-muted lg:hidden"
            >
              <IconMenu className="h-5 w-5" />
            </button>
          }
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
