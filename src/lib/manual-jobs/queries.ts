import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ManualJob, ManualJobCreationContext, ManualJobWorker, WeeklyManualEarning } from "./types";

export async function getManualJobCreationContext(): Promise<ManualJobCreationContext> {
  const { data, error } = await (await createClient()).rpc("get_manual_job_creation_context");
  if (error || !data?.[0]) throw new Error("No se pudo cargar el período financiero disponible.");
  return data[0] as ManualJobCreationContext;
}

function normalizeWorker(worker: ManualJobWorker): ManualJobWorker {
  return {
    ...worker,
    percentageBasisPoints: Number(worker.percentageBasisPoints),
    allocatedCents: worker.allocatedCents === undefined ? undefined : Number(worker.allocatedCents),
  };
}

export async function getMyManualJobs(): Promise<ManualJob[]> {
  const { data, error } = await (await createClient()).rpc("list_manual_jobs_v2");
  if (error) throw new Error("No se pudieron cargar los trabajos manuales.");

  return ((data ?? []) as ManualJob[]).map((job) => ({
    ...job,
    value_cents: Number(job.value_cents),
    workers: (job.workers ?? []).map(normalizeWorker),
  }));
}

export async function getOfficeManualJobs(): Promise<ManualJob[]> {
  const { data, error } = await (await createClient()).rpc("list_manual_jobs_v2");
  if (error) throw new Error("No se pudieron cargar los trabajos manuales.");
  return ((data ?? []) as ManualJob[]).map((job) => ({
    ...job,
    value_cents: Number(job.value_cents),
    workers: (job.workers ?? []).map(normalizeWorker),
  }));
}

export async function getMyWeeklyManualEarnings(referenceDate?: string | null): Promise<WeeklyManualEarning[]> {
  const { data, error } = await (await createClient()).rpc("get_my_weekly_manual_earnings_v2", {
    p_reference_date: referenceDate ?? null,
  });
  if (error) throw new Error("No se pudieron cargar tus ganancias manuales semanales.");

  return ((data ?? []) as WeeklyManualEarning[]).map((line) => ({
    ...line,
    source_amount_cents: Number(line.source_amount_cents),
    percentage_basis_points: Number(line.percentage_basis_points),
    allocated_cents: Number(line.allocated_cents),
  }));
}
