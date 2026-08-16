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
  { href: "#evidencias", label: "Evidencias", icon: IconCamera },
  { href: "/jornada/iniciar", label: "Jornada", icon: IconActivity },
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/trabajos") {
    return pathname === "/trabajos" || pathname.startsWith("/trabajos");
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
    <div className="flex min-h-screen bg-white">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line lg:flex">
        <div className="flex h-16 shrink-0 items-center px-6">
          <Image
            src="/login/susotech-logo.png"
            alt="Susotech"
            width={120}
            height={44}
            priority
            className="h-auto w-[120px]"
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
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
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
        <div className="border-t border-line px-3 py-4">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-brand-900"
          >
            <IconLogout className="h-5 w-5" />
            Cerrar sesión
          </button>
          <p className="mt-3 truncate px-3 text-xs text-ink-muted">{userName}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-line bg-white px-4 lg:hidden">
          <Image
            src="/login/susotech-logo.png"
            alt="Susotech"
            width={80}
            height={30}
            priority
            className="h-auto w-[80px]"
          />
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-ink-soft">{userName}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 rounded-lg border-0 bg-transparent p-2 text-sm font-medium text-ink-soft hover:bg-surface-muted hover:text-brand-900"
            >
              <IconLogout className="h-5 w-5" />
              <span className="sr-only">Cerrar sesión</span>
            </button>
          </div>
        </header>
        <main className="flex-1 pb-24 lg:pb-8">{children}</main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
