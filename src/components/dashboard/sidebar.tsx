"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  IconBriefcase,
  IconClipboardCheck,
  IconDashboard,
  IconLogout,
  IconTag,
  IconUpload,
  IconUserCog,
  IconUsers,
  type IconProps,
} from "@/components/ui/icons";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
};

function isActive(href: string, pathname: string): boolean {
  if (href === "/trabajos/importar") return pathname === "/trabajos/importar";
  if (href === "/trabajos") {
    return pathname === "/trabajos" || pathname.startsWith("/trabajos/");
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
    { href: "/trabajos/importar", label: "Importar PDFs", icon: IconUpload },
    {
      href: "/trabajos?status=en_revision",
      label: "Revisión",
      icon: IconClipboardCheck,
    },
    { href: "/equipos", label: "Equipos", icon: IconUsers },
    ...(role === "admin"
      ? [
          { href: "/catalogo", label: "Lista de precios", icon: IconTag },
          { href: "/usuarios", label: "Usuarios", icon: IconUserCog },
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
      <div className="flex h-16 shrink-0 items-center px-6">
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
    </div>
  );
}
