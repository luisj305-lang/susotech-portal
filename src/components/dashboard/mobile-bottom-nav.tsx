"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import {
  IconActivity,
  IconBriefcase,
  IconCamera,
  IconDashboard,
  IconRoute,
  type IconProps,
} from "@/components/ui/icons";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
};

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: IconDashboard },
  { href: "/trabajos", label: "Mis trabajos", icon: IconBriefcase },
  { href: "/trabajos/mi-ruta", label: "Mi ruta", icon: IconRoute },
  { href: "#evidencias", label: "Evidencias", icon: IconCamera },
  { href: "/jornada/iniciar", label: "Jornada", icon: IconActivity },
  { href: "/manual", label: "Trabajo manual", icon: IconActivity },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[var(--safe-area-bottom)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] shadow-[var(--shadow-soft)] backdrop-blur lg:hidden"
      aria-label="Navegación principal"
    >
      <div className="grid grid-cols-6">
        {ITEMS.map((item) => {
          const active =
            item.href === pathname ||
            (item.href === "/trabajos" && pathname.startsWith("/trabajos") && !pathname.startsWith("/trabajos/mi-ruta"));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-center transition-colors",
                active
                  ? "bg-brand-50/80 text-brand-900"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink-soft",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="text-[10px] font-semibold leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
