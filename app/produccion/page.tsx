import Link from "next/link";
import { requireSupervisor } from "@/lib/auth/session";
import { getFinancialAllocationReport, getProductionReport } from "@/lib/jobs/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function isoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default async function ProductionPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSupervisor();
  const values = await searchParams;
  const value = (key: string) => Array.isArray(values[key]) ? values[key][0] : values[key];
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - 30);
  const start = value("start") || isoDate(defaultStart);
  const end = value("end") || isoDate(today);
  const [rows, financial] = await Promise.all([getProductionReport(start, end), getFinancialAllocationReport(start, end)]);
  const confirmed = financial.filter((row) => row.billing_state === "confirmed").reduce((sum, row) => sum + Number(row.allocated_cents), 0) / 100;
  const pending = financial.filter((row) => row.billing_state === "pending").reduce((sum, row) => sum + Number(row.allocated_cents), 0) / 100;

  return <main className="min-h-screen bg-white px-4 py-8 text-black sm:px-8"><div className="mx-auto max-w-7xl">
    <Link href="/dashboard" className="text-sm font-medium">← Dashboard</Link>
    <header className="my-6"><p className="text-sm font-semibold uppercase tracking-widest">Operaciones</p><h1 className="text-3xl font-bold">Producción y distribución financiera</h1><p className="mt-2">Las cantidades operativas y la distribución financiera se presentan por separado.</p></header>
    <form className="flex flex-wrap items-end gap-3 border border-black p-4"><label className="grid gap-1">Desde<input type="date" name="start" defaultValue={start} /></label><label className="grid gap-1">Hasta<input type="date" name="end" defaultValue={end} /></label><button className="border border-black px-5 py-3 font-semibold">Aplicar</button></form>
    <section className="my-6 grid gap-3 sm:grid-cols-2"><div className="border border-black p-5"><p>Confirmado</p><strong className="text-2xl">${confirmed.toFixed(2)}</strong></div><div className="border border-black p-5"><p>Pendiente</p><strong className="text-2xl">${pending.toFixed(2)}</strong></div></section>
    <h2 className="mb-2 text-xl font-bold">Producción operativa por código</h2><div className="overflow-x-auto border border-black"><table className="w-full border-collapse text-sm"><thead><tr><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Responsable</th><th className="p-3 text-left">Código</th><th className="p-3 text-left">Descripción</th><th className="p-3 text-right">Cantidad</th><th className="p-3 text-right">Tarifa snapshot</th><th className="p-3 text-right">Total fuente</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.production_date}-${row.technician_id}-${row.code}-${index}`} className="border-t border-black"><td className="p-3">{row.production_date}</td><td className="p-3">{row.technician_name}</td><td className="p-3 font-semibold">{row.code}</td><td className="p-3">{row.description}</td><td className="p-3 text-right">{row.quantity} {row.unit === "foot" ? "ft" : row.unit === "hour" ? "hr" : ""}</td><td className="p-3 text-right">${Number(row.unit_rate).toFixed(3)}</td><td className="p-3 text-right">${Number(row.amount).toFixed(2)}</td></tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center">No hay producción en este período.</p>}</div>
    <h2 className="mb-2 mt-8 text-xl font-bold">Distribución financiera vigente</h2><div className="overflow-x-auto border border-black"><table className="w-full border-collapse text-sm"><thead><tr><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">PRISM</th><th className="p-3 text-left">Participante</th><th className="p-3 text-left">Especialidad</th><th className="p-3 text-right">Porcentaje</th><th className="p-3 text-right">Importe</th><th className="p-3 text-left">Estado</th></tr></thead><tbody>{financial.map((row) => <tr key={`${row.delivery_id}-${row.participant_id}`} className="border-t border-black"><td className="p-3">{row.allocation_date}</td><td className="p-3">{row.prism_number ?? "—"}</td><td className="p-3">{row.participant_name}</td><td className="p-3">{row.worker_specialty}</td><td className="p-3 text-right">{(Number(row.percentage_basis_points) / 100).toFixed(2)}%</td><td className="p-3 text-right font-semibold">${(Number(row.allocated_cents) / 100).toFixed(2)}</td><td className="p-3">{row.billing_state === "confirmed" ? "Confirmado" : "Pendiente"}</td></tr>)}</tbody></table>{!financial.length && <p className="p-8 text-center">No hay distribuciones en este período.</p>}</div>
  </div></main>;
}
