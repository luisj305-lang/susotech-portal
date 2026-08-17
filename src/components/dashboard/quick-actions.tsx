import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import {
  IconBriefcase,
  IconClipboardCheck,
  IconUpload,
  IconUserCog,
  IconUsers,
} from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export function QuickActions({ role }: { role: "admin" | "supervisor" }) {
  const actions = [
    {
      href: "/trabajos/importar",
      label: "Importar trabajos",
      icon: IconUpload,
      primary: true,
    },
    {
      href: "/trabajos",
      label: "Ver todos los trabajos",
      icon: IconBriefcase,
      primary: false,
    },
    {
      href: "/trabajos?status=en_revision",
      label: "Revisar trabajos enviados",
      icon: IconClipboardCheck,
      primary: false,
    },
    {
      href: "/equipos",
      label: "Administrar equipos",
      icon: IconUsers,
      primary: false,
    },
    ...(role === "admin"
      ? [
          {
            href: "/usuarios",
            label: "Administrar usuarios",
            icon: IconUserCog,
            primary: false,
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acciones rápidas</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className={cn(
                buttonClasses({
                  variant: action.primary ? "primary" : "secondary",
                  size: "lg",
                }),
                "w-full",
              )}
            >
              <Icon className="h-5 w-5" />
              {action.label}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
