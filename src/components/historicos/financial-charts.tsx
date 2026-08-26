"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancialHistoryBucket } from "@/lib/jobs/types";

type ChartPoint = {
  date: string;
  ingresos: number;
  gastos: number;
  trabajadores: number;
  gasolina: number;
};

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatShortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export default function FinancialCharts({ buckets }: { buckets: FinancialHistoryBucket[] }) {
  const data: ChartPoint[] = buckets.map((bucket) => {
    const trabajadores = bucket.worker_expense_cents / 100;
    const gasolina = bucket.fuel_expense_cents / 100;
    return {
      date: bucket.bucket_date,
      ingresos: bucket.income_cents / 100,
      trabajadores,
      gasolina,
      gastos: trabajadores + gasolina,
    };
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
        <h2 className="mb-4 text-xl font-bold text-ink">Ingresos vs Gastos</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(value: number) => `$${value.toLocaleString("en-US")}`}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number | string, name: string) => [formatCurrency(Number(value)), name === "ingresos" ? "Ingresos" : "Gastos"]}
                labelFormatter={formatShortDate}
              />
              <Legend />
              <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#059669" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="gastos" name="Gastos" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
        <h2 className="mb-4 text-xl font-bold text-ink">Composición de gastos</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(value: number) => `$${value.toLocaleString("en-US")}`}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number | string, name: string) => [formatCurrency(Number(value)), name === "trabajadores" ? "Trabajadores" : "Gasolina"]}
                labelFormatter={formatShortDate}
              />
              <Legend />
              <Bar dataKey="trabajadores" name="Trabajadores" stackId="gastos" fill="#0f766e" />
              <Bar dataKey="gasolina" name="Gasolina" stackId="gastos" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
