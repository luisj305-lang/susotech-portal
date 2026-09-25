import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function RecruitmentNotFound() {
  return <section className="mx-auto my-10 max-w-xl space-y-4 rounded-2xl border border-line bg-white p-6"><h1 className="text-2xl font-bold text-ink">Solicitud no encontrada</h1><p className="text-ink-muted">La solicitud no existe o no está disponible.</p><Link href="/postulantes" className={buttonClasses({ variant: "secondary" })}>Volver a postulantes</Link></section>;
}
