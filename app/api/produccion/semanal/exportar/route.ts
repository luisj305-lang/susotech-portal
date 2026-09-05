import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyExport } from "@/lib/jobs/queries";

export const runtime = "nodejs";

function referenceDateForWeek(weekOffset: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000),
  );
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: Request) {
  const profile = await requireProfile();
  if (profile.role !== "tecnico") {
    return new Response("Acceso denegado.", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }

  const rawWeek = new URL(request.url).searchParams.get("week") ?? "0";
  const weekOffset = Number.isFinite(Number(rawWeek)) ? Number(rawWeek) : 0;
  const referenceDate = referenceDateForWeek(weekOffset);

  let lines;
  try {
    lines = await getMyWeeklyExport(referenceDate);
  } catch {
    return new Response("No se pudo generar la exportación.", {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }

  const header = ["PRISM", "Fecha", "Monto total (USD)", "Participante", "Especialidad", "Porcentaje", "Monto (USD)", "Estado"];
  const rows = lines.map((line) =>
    [
      line.prism_number ?? "",
      line.week_end,
      (line.source_amount_cents / 100).toFixed(2),
      line.participant_name,
      line.worker_specialty,
      `${(line.percentage_basis_points / 100).toFixed(2)}%`,
      (line.allocated_cents / 100).toFixed(2),
      line.billing_state === "confirmed" ? "Confirmado" : "Pendiente",
    ].map(escapeCsvCell).join(","),
  );
  const csv = [header.join(","), ...rows].join("\r\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="produccion-semanal.csv"',
      "cache-control": "no-store",
    },
  });
}
