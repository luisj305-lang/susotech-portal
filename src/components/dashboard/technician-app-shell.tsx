"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  IconActivity,
  IconBriefcase,
  IconCamera,
  IconDashboard,
  IconLogout,
  IconRoute,
  type IconProps,
} from "@/components/ui/icons";
import { MobileBottomNav } from "./mobile-bottom-nav";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: IconDashboard },
  { href: "/trabajos", label: "Mis trabajos", icon: IconBriefcase },
  { href: "/trabajos/mi-ruta", label: "Mi ruta", icon: IconRoute },
  { href: "#evidencias", label: "Evidencias", icon: IconCamera },
  { href: "/jornada/iniciar", label: "Jornada", icon: IconActivity },
  { href: "/manual", label: "Trabajo manual", icon: IconActivity },
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/trabajos") {
    return pathname === "/trabajos" || (pathname.startsWith("/trabajos") && !pathname.startsWith("/trabajos/mi-ruta"));
  }
  return pathname === href;
}

export function TechnicianAppShell({
  userName,
  children,
}: {
  userName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("technician-shift-prompt:")) {
        sessionStorage.removeItem(key);
      }
    }
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen bg-surface-muted">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-white lg:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-line/70 px-5">
          <Image
            src="/login/susotech-logo.png"
            alt="Susotech"
            width={112}
            height={41}
            priority
            className="h-auto w-28"
          />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex min-h-[var(--control-height)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-50 font-semibold text-brand-900"
                    : "text-ink-soft hover:bg-surface-muted hover:text-brand-900",
                )}
              >
                {active ? (
                  <span
                    className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded bg-brand-900"
                    aria-hidden="true"
                  />
                ) : null}
                <Icon className={cn("h-5 w-5", active ? "text-brand-900" : undefined)} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line bg-surface-muted/60 px-3 py-4">
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-[var(--control-height)] w-full items-center gap-3 rounded-[var(--radius-control)] border-0 bg-transparent px-3 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-white hover:text-brand-900"
          >
            <IconLogout className="h-5 w-5" />
            Cerrar sesión
          </button>
          <p className="mt-3 truncate px-3 text-xs text-ink-muted">{userName}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-surface-muted">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-white/95 px-4 pt-[var(--safe-area-top)] shadow-[var(--shadow-soft)] backdrop-blur lg:hidden">
          <Image
            src="/login/susotech-logo.png"
            alt="Susotech"
            width={88}
            height={32}
            priority
            className="h-auto w-[88px]"
          />
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-44 truncate text-sm font-medium text-ink-soft">{userName}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border-0 bg-transparent text-sm font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-brand-900"
            >
              <IconLogout className="h-5 w-5" />
              <span className="sr-only">Cerrar sesión</span>
            </button>
          </div>
        </header>
        <main className="flex-1 pb-[calc(4.75rem+var(--safe-area-bottom))] lg:pb-6">{children}</main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
