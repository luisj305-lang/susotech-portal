import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { buttonClasses } from "@/components/ui/button";

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 shadow-card">
        <h1 className="text-2xl font-bold text-ink">Acceso denegado</h1>
        <p className="mt-4 text-sm text-ink-muted">
          Tu cuenta no tiene permiso para abrir esta página o está inactiva.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link href="/dashboard" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Volver al dashboard
          </Link>
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
