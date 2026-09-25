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
import styles from "./admin-dashboard.module.css";
import type { AdminDashboardPresentation } from "./admin-dashboard-presentation";

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

function PayrollIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
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
  if (href === "/postulantes") {
    return pathname === "/postulantes" || pathname.startsWith("/postulantes/");
  }
  return pathname === href;
}

export function Sidebar({
  role,
  userName,
  presentation = "default",
}: {
  role: "admin" | "supervisor";
  userName: string;
  presentation?: AdminDashboardPresentation;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = presentation === "admin-dashboard";

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
    { href: "/nomina", label: "Nómina", icon: PayrollIcon },
    { href: "/postulantes", label: "Postulantes", icon: IconUserCog },
    ...(role === "admin"
      ? [
          { href: "/catalogo", label: "Lista de precios", icon: IconTag },
          { href: "/usuarios", label: "Usuarios", icon: IconUserCog },
          { href: "/historicos", label: "Históricos", icon: IconChartBar },
        ]
      : []),
  ];

  const operations = items.slice(0, 6);
  const administration = items.slice(6);

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

  const renderLink = (item: NavItem) => {
    const active = isActive(item.href, pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={
          isAdmin
            ? cn(
                "relative flex min-h-[var(--control-height)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 font-semibold text-white"
                  : "text-brand-100/80 hover:bg-white/10 hover:text-white",
              )
            : cn(
                "relative flex min-h-[var(--control-height)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 font-semibold text-brand-900"
                  : "text-ink-soft hover:bg-surface-muted hover:text-brand-900",
              )
        }
      >
        {active ? (
          <span
            className={cn(
              "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded",
              isAdmin ? "bg-accent-500" : "bg-brand-900",
            )}
            aria-hidden="true"
          />
        ) : null}
        <Icon
          className={cn(
            "h-5 w-5",
            active ? (isAdmin ? "text-white" : "text-brand-900") : undefined,
          )}
        />
        {item.label}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-[4.5rem] shrink-0 items-center border-b px-5",
          isAdmin ? "border-white/10" : "border-line/70",
        )}
      >
        {isAdmin ? (
          <div className="rounded-[var(--radius-control)] bg-white px-3 py-1.5">
            <Image
              src="/login/susotech-logo.png"
              alt="Susotech"
              width={132}
              height={48}
              priority
              className="h-auto w-[132px]"
            />
          </div>
        ) : (
          <Image
            src="/login/susotech-logo.png"
            alt="Susotech"
            width={132}
            height={48}
            priority
            className="h-auto w-[132px]"
          />
        )}
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {isAdmin ? (
          <>
            <p className={styles.sideGroupLabel}>Operación</p>
            {operations.map(renderLink)}
            {administration.length > 0 ? (
              <>
                <p className={styles.sideGroupLabel}>Administración</p>
                {administration.map(renderLink)}
              </>
            ) : null}
          </>
        ) : (
          items.map(renderLink)
        )}
      </nav>
      <div
        className={cn(
          "border-t px-3 py-4",
          isAdmin ? "border-white/10 bg-white/5" : "border-line bg-surface-muted/60",
        )}
      >
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            "flex min-h-[var(--control-height)] w-full items-center gap-3 rounded-[var(--radius-control)] border-0 bg-transparent px-3 text-left text-sm font-medium",
            isAdmin
              ? "text-brand-100/80 hover:bg-white/10 hover:text-white"
              : "text-ink-soft hover:bg-white hover:text-brand-900",
          )}
        >
          <IconLogout className="h-5 w-5" />
          Cerrar sesión
        </button>
        <p
          className={cn(
            "mt-3 truncate px-3 text-xs",
            isAdmin ? "text-brand-100/50" : "text-ink-muted",
          )}
        >
          {userName}
        </p>
      </div>
    </div>
  );
}
