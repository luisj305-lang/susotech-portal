"use client";

import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";

export default function RecruitmentError({ retry }: { retry: () => void }) {
  return <section className="mx-auto my-10 max-w-xl space-y-4 rounded-2xl border border-line bg-white p-6" role="alert">
    <h1 className="text-2xl font-bold text-ink">No se pudieron cargar los postulantes</h1>
    <p className="text-ink-muted">Intente nuevamente. Si el problema continúa, contacte al administrador.</p>
    <div className="flex flex-wrap gap-3"><Button onClick={() => retry()}>Reintentar</Button><Link href="/dashboard" className={buttonClasses({ variant: "secondary" })}>Volver al dashboard</Link></div>
  </section>;
}
