import Link from "next/link";
import { BulkImport } from "@/components/jobs/bulk-import";
import { requireSupervisor } from "@/lib/auth/session";
import { listAssigneeOptions } from "@/lib/jobs/queries";

export default async function ImportJobsPage() {
  await requireSupervisor();
  const options = await listAssigneeOptions();
  return <main className="min-h-screen bg-black px-4 py-8 text-white sm:px-8"><div className="mx-auto max-w-[1500px]"><Link href="/trabajos" className="text-sm font-medium">← Trabajos</Link><header className="my-6"><p className="text-sm font-semibold uppercase tracking-widest text-white">Importación masiva</p><h1 className="text-3xl font-bold">Importar órdenes PDF</h1><p className="mt-2 max-w-3xl text-white">Revisa los datos detectados, corrige lo necesario y confirma la asignación. Un archivo con error no detiene a los demás.</p></header><BulkImport options={options} /></div></main>;
}
