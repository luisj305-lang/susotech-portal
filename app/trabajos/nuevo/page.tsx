import Link from "next/link";
import { JobForm } from "@/components/jobs/job-form";
import { requireSupervisor } from "@/lib/auth/session";

export default async function NewJobPage() {
  await requireSupervisor();
  return <main className="min-h-screen bg-white px-4 py-8 text-black sm:px-8"><div className="mx-auto max-w-3xl"><Link href="/trabajos" className="text-sm font-medium">← Trabajos</Link><h1 className="my-6 text-3xl font-bold">Nuevo trabajo</h1><JobForm /></div></main>;
}
