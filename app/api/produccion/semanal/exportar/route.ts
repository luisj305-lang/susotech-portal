import { requireProfile } from "@/lib/auth/session";
import { getMyWeeklyExport } from "@/lib/jobs/queries";
import { getMyWeeklyManualEarnings } from "@/lib/manual-jobs/queries";
import type { WeeklyManualEarning } from "@/lib/manual-jobs/types";
import type { WeeklyExportLine } from "@/lib/jobs/types";
import { referenceDateForNewYorkWeek } from "@/lib/time/new-york-week";

export const runtime = "nodejs";

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildWeeklyProductionCsv(deliveryLines: WeeklyExportLine[], manualLines: WeeklyManualEarning[]): string {
  const header = ["Origen", "PRISM", "Fecha", "Monto total (USD)", "Participante", "Especialidad", "Porcentaje", "Monto (USD)", "Estado"];
  const deliveryRows = deliveryLines.map((line) =>
    [
      "Entrega regular",
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
  const manualRows = manualLines.map((line) =>
    [
      "Trabajo manual",
      line.prism_number,
      line.financial_date ?? line.approval_date,
      (line.source_amount_cents / 100).toFixed(2),
      "Mi participación",
      "",
      `${(line.percentage_basis_points / 100).toFixed(2)}%`,
      (line.allocated_cents / 100).toFixed(2),
      "Aprobado",
    ].map(escapeCsvCell).join(","),
  );
  return [header.join(","), ...deliveryRows, ...manualRows].join("\r\n");
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
  const referenceDate = referenceDateForNewYorkWeek(weekOffset);

  let deliveryLines;
  let manualLines;
  try {
    [deliveryLines, manualLines] = await Promise.all([
      getMyWeeklyExport(referenceDate),
      getMyWeeklyManualEarnings(referenceDate),
    ]);
  } catch {
    return new Response("No se pudo generar la exportación.", {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }

  const csv = buildWeeklyProductionCsv(deliveryLines, manualLines);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="produccion-semanal.csv"',
      "cache-control": "no-store",
    },
  });
}
