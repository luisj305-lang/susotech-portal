"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { IconMenu, IconX } from "@/components/ui/icons";

export function AppShell({
  role,
  userName,
  roleLabel,
  initials,
  children,
}: {
  role: "admin" | "supervisor";
  userName: string;
  roleLabel: string;
  initials: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="hidden border-r border-line lg:flex lg:w-64 lg:shrink-0 lg:flex-col">
        <Sidebar role={role} userName={userName} />
      </aside>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-brand-950/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl">
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-lg border-0 bg-transparent p-2 text-ink-soft hover:bg-surface-muted"
            >
              <IconX className="h-5 w-5" />
            </button>
            <Sidebar role={role} userName={userName} />
          </aside>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={userName}
          roleLabel={roleLabel}
          initials={initials}
          menuButton={
            <button
              type="button"
              aria-label="Abrir menú"
              onClick={() => setOpen(true)}
              className="rounded-lg border-0 bg-transparent p-2 text-ink-soft hover:bg-surface-muted lg:hidden"
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
