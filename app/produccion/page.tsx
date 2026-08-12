import Link from "next/link";
import { requireSupervisor } from "@/lib/auth/session";
import { getProductionReport } from "@/lib/jobs/queries";

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
  const rows = await getProductionReport(start, end);
  const confirmed = rows.filter((row) => row.billing_state === "confirmed").reduce((sum, row) => sum + Number(row.amount), 0);
  const pending = rows.filter((row) => row.billing_state === "pending").reduce((sum, row) => sum + Number(row.amount), 0);

  return <main className="min-h-screen bg-black px-4 py-8 text-white sm:px-8"><div className="mx-auto max-w-7xl">
    <Link href="/dashboard" className="text-sm font-medium">← Dashboard</Link>
    <header className="my-6"><p className="text-sm font-semibold uppercase tracking-widest">Operaciones</p><h1 className="text-3xl font-bold">Producción por código</h1><p className="mt-2">Importes registrados por técnico, día y actividad.</p></header>
    <form className="flex flex-wrap items-end gap-3 border border-white p-4"><label className="grid gap-1">Desde<input type="date" name="start" defaultValue={start} /></label><label className="grid gap-1">Hasta<input type="date" name="end" defaultValue={end} /></label><button className="border border-white px-5 py-3 font-semibold">Aplicar</button></form>
    <section className="my-6 grid gap-3 sm:grid-cols-2"><div className="border border-white p-5"><p>Confirmado</p><strong className="text-2xl">${confirmed.toFixed(2)}</strong></div><div className="border border-white p-5"><p>Pendiente</p><strong className="text-2xl">${pending.toFixed(2)}</strong></div></section>
    <div className="overflow-x-auto border border-white"><table className="w-full border-collapse text-sm"><thead><tr><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Técnico</th><th className="p-3 text-left">Código</th><th className="p-3 text-left">Descripción</th><th className="p-3 text-right">Cantidad</th><th className="p-3 text-right">Tarifa</th><th className="p-3 text-right">Importe</th><th className="p-3 text-left">Estado</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.production_date}-${row.technician_id}-${row.code}-${index}`} className="border-t border-white"><td className="p-3">{row.production_date}</td><td className="p-3">{row.technician_name}</td><td className="p-3 font-semibold">{row.code}</td><td className="p-3">{row.description}</td><td className="p-3 text-right">{row.quantity} {row.unit === "foot" ? "ft" : row.unit === "hour" ? "hr" : ""}</td><td className="p-3 text-right">${Number(row.unit_rate).toFixed(3)}</td><td className="p-3 text-right font-semibold">${Number(row.amount).toFixed(2)}</td><td className="p-3">{row.billing_state === "confirmed" ? "Confirmado" : "Pendiente"}</td></tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center">No hay producción en este período.</p>}</div>
  </div></main>;
}
