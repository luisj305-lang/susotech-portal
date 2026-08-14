import type { WorkerOperationsRow } from "@/lib/jobs/types";

const dateTime = new Intl.DateTimeFormat("es-US", {
  timeZone: "America/New_York",
  dateStyle: "short",
  timeStyle: "short",
});

const time = new Intl.DateTimeFormat("es-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

function formatQuantity(value: number) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function WorkerOperationsTable({ rows }: { rows: WorkerOperationsRow[] }) {
  const totalProduction = rows.reduce((sum, row) => sum + Number(row.weekly_production), 0);
  const totalJobs = rows.reduce((sum, row) => sum + Number(row.weekly_delivered_jobs), 0);
  const totalFuel = rows.reduce((sum, row) => sum + Number(row.weekly_fuel_amount), 0);
  const totalAllocated = rows.reduce((sum, row) => sum + Number(row.weekly_allocated_cents ?? 0), 0);
  const start = rows[0]?.week_start_at;
  const end = rows[0]?.week_end_exclusive_at;

  return <section className="mb-8 rounded-2xl border border-current p-5">
    <div className="mb-4">
      <h2 className="text-xl font-bold">Operación semanal</h2>
      <p className="text-sm">{start && end ? `${dateTime.format(new Date(start))} — ${dateTime.format(new Date(new Date(end).getTime() - 1))}` : "Viernes — jueves · America/New_York"}</p>
    </div>
    <div className="overflow-x-auto">
      <table className="min-w-[980px] w-full border-collapse text-left text-sm">
        <thead><tr>{["Técnico", "Crew(s)", "Estado", "Inicio", "Finaliza", "Producción", "Distribución", "Trabajos", "Gasolina"].map((label) => <th key={label} className="border border-current p-3">{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.technician_id}>
            <td className="border border-current p-3 font-semibold">{row.technician_name}</td>
            <td className="border border-current p-3">{row.crew_names.join(", ") || "Sin crew"}</td>
            <td className="border border-current p-3"><strong>{row.is_shift_active ? "Activo" : "Inactivo"}</strong>{row.is_shift_active && row.shift_active_until && <span className="block text-xs">Activo hasta {time.format(new Date(row.shift_active_until))}</span>}</td>
            <td className="border border-current p-3">{row.shift_started_at ? dateTime.format(new Date(row.shift_started_at)) : "—"}</td>
            <td className="border border-current p-3">{row.shift_active_until ? dateTime.format(new Date(row.shift_active_until)) : "—"}</td>
            <td className="border border-current p-3"><strong>{formatQuantity(row.weekly_production)}</strong>{row.production_breakdown.length > 0 && <details className="mt-1"><summary className="cursor-pointer text-xs underline">Por código</summary><ul className="mt-1">{row.production_breakdown.map((item) => <li key={`${item.code}:${item.unit}`}>{item.code}: {formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</li>)}</ul></details>}</td>
            <td className="border border-current p-3">${(Number(row.weekly_allocated_cents ?? 0) / 100).toFixed(2)}</td>
            <td className="border border-current p-3">{row.weekly_delivered_jobs}</td>
            <td className="border border-current p-3">${Number(row.weekly_fuel_amount).toFixed(2)}</td>
          </tr>)}
          <tr className="font-bold"><td colSpan={5} className="border border-current p-3">TOTALES</td><td className="border border-current p-3">{formatQuantity(totalProduction)}</td><td className="border border-current p-3">${(totalAllocated / 100).toFixed(2)}</td><td className="border border-current p-3">{totalJobs}</td><td className="border border-current p-3">${totalFuel.toFixed(2)}</td></tr>
        </tbody>
      </table>
    </div>
    <p className="mt-3 text-xs">La producción suma cantidades registradas de distintas unidades; usa el desglose por código para interpretar cada medida.</p>
  </section>;
}
