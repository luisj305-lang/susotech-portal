import Link from "next/link";
import { CrewManager } from "@/components/jobs/crew-manager";
import { requireSupervisor } from "@/lib/auth/session";
import { listCrewManagementData } from "@/lib/jobs/queries";

export default async function CrewsPage() {
  const profile = await requireSupervisor();
  const { crews, technicians } = await listCrewManagementData();
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-8"><div className="mx-auto max-w-6xl">
    <Link href="/dashboard" className="text-sm font-medium">← Dashboard</Link>
    <header className="my-6"><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">Operaciones</p><h1 className="text-3xl font-bold">Equipos</h1><p className="mt-1 text-slate-600">Organiza responsables e integrantes para asignar trabajos.</p></header>
    <CrewManager crews={crews} technicians={technicians} canManage={profile.role === "admin"} />
  </div></main>;
}
