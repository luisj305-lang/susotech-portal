"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  IconBriefcase,
  IconChartBar,
  IconClipboardCheck,
  IconDashboard,
  IconLogout,
  IconTag,
  IconUpload,
  IconUserCog,
  type IconProps,
} from "@/components/ui/icons";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
};

function FleetIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path data-part="utility-pole" d="M21.5 2v16.5M20 5h3" />
      <path data-part="worker-bucket" d="M16.4 4.2h3.5l-.4 3h-2.7z" />
      <polyline data-part="hydraulic-boom" points="8,13 10.5,9 14.7,7 17.2,7" />
      <circle cx="10.5" cy="9" r=".7" />
      <path data-part="service-truck" d="M2.5 13h9.2v4H2.5zM11.7 12h3.5l3 2.6V17h-6.5zM14.2 12.2v2.4h3.7" />
      <path d="M7.2 13v-1.2h1.6V13M3.5 17h16" />
      <g data-part="wheels">
        <circle cx="6" cy="18.5" r="1.5" />
        <circle cx="15.5" cy="18.5" r="1.5" />
      </g>
    </svg>
  );
}

function isActive(href: string, pathname: string): boolean {
  if (href === "/trabajos/importar") return pathname === "/trabajos/importar";
  if (href === "/trabajos") {
    return pathname === "/trabajos" || pathname.startsWith("/trabajos/");
  }
  if (href === "/camiones") {
    return pathname === "/camiones" || pathname.startsWith("/camiones/");
  }
  return pathname === href;
}

export function Sidebar({
  role,
  userName,
}: {
  role: "admin" | "supervisor";
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
    { href: "/trabajos", label: "Trabajos", icon: IconBriefcase },
    { href: "/camiones", label: "Camiones", icon: FleetIcon },
    { href: "/trabajos/importar", label: "Importar PDFs", icon: IconUpload },
    {
      href: "/trabajos?status=en_revision",
      label: "Revisión",
      icon: IconClipboardCheck,
    },
    { href: "/manual", label: "Trabajos manuales", icon: IconClipboardCheck },
    ...(role === "admin"
      ? [
          { href: "/catalogo", label: "Lista de precios", icon: IconTag },
          { href: "/usuarios", label: "Usuarios", icon: IconUserCog },
          { href: "/historicos", label: "Históricos", icon: IconChartBar },
        ]
      : []),
  ];

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
    <div className="flex h-full flex-col">
      <div className="flex h-[4.5rem] shrink-0 items-center border-b border-line/70 px-5">
        <Image
          src="/login/susotech-logo.png"
          alt="Susotech"
          width={132}
          height={48}
          priority
          className="h-auto w-[132px]"
        />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
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
          className="flex min-h-[var(--control-height)] w-full items-center gap-3 rounded-[var(--radius-control)] border-0 bg-transparent px-3 text-left text-sm font-medium text-ink-soft hover:bg-white hover:text-brand-900"
        >
          <IconLogout className="h-5 w-5" />
          Cerrar sesión
        </button>
        <p className="mt-3 truncate px-3 text-xs text-ink-muted">{userName}</p>
      </div>
    </div>
  );
}
