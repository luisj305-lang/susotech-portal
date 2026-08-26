"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Result<T = null> =
  | { success: true; message: string; data: T }
  | { success: false; message: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function failure(message: string): Result<never> {
  return { success: false, message };
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const cleaned = value.trim();
  return cleaned.length <= max ? cleaned : null;
}

function refresh(jobId: string) {
  revalidatePath("/trabajos");
  revalidatePath("/trabajos/ruta");
  revalidatePath(`/trabajos/${jobId}`);
}

export async function createJobStage(input: {
  jobId: string;
  title: string;
  description?: string | null;
}): Promise<Result<{ id: string }>> {
  const profile = await requireSupervisor();
  if (!uuidPattern.test(input.jobId)) return failure("El trabajo no es válido.");
  const title = cleanText(input.title, 200);
  if (!title) return failure("El nombre de la etapa es obligatorio y no puede superar 200 caracteres.");
  const description = input.description ? cleanText(input.description, 2000) : null;
  if (input.description && !description) return failure("La descripción no puede superar 2000 caracteres.");

  const supabase = await createClient();
  const [jobResult, lastStageResult] = await Promise.all([
    supabase.from("jobs").select("id, archived_at").eq("id", input.jobId).maybeSingle(),
    supabase.from("job_stages").select("sequence").eq("job_id", input.jobId)
      .order("sequence", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (jobResult.error || !jobResult.data) return failure("Trabajo no disponible.");
  if (jobResult.data.archived_at) return failure("Restaura el trabajo antes de agregar una etapa.");
  if (lastStageResult.error) return failure("No se pudo preparar la nueva etapa.");

  const { data, error } = await supabase.from("job_stages").insert({
    job_id: input.jobId,
    sequence: Number(lastStageResult.data?.sequence ?? 0) + 1,
    title,
    description,
    created_by: profile.id,
  }).select("id").single();
  if (error || !data) return failure("No se pudo crear la etapa. Inténtalo nuevamente.");
  refresh(input.jobId);
  return { success: true, message: "Etapa creada.", data };
}

export async function completeJobStage(input: { jobId: string; stageId: string }): Promise<Result> {
  const profile = await requireSupervisor();
  if (!uuidPattern.test(input.jobId) || !uuidPattern.test(input.stageId)) return failure("La etapa no es válida.");
  const { data, error } = await (await createClient()).from("job_stages")
    .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: profile.id })
    .eq("id", input.stageId).eq("job_id", input.jobId).eq("status", "pending")
    .select("id").maybeSingle();
  if (error || !data) return failure("Sólo una etapa pendiente puede marcarse como completada.");
  refresh(input.jobId);
  return { success: true, message: "Etapa completada.", data: null };
}

export async function invoiceJobStage(input: {
  jobId: string;
  stageId: string;
  invoiceNumber: string;
  invoicePath?: string | null;
}): Promise<Result> {
  const profile = await requireSupervisor();
  if (!uuidPattern.test(input.jobId) || !uuidPattern.test(input.stageId)) return failure("La etapa no es válida.");
  const invoiceNumber = cleanText(input.invoiceNumber, 200);
  if (!invoiceNumber) return failure("El número de factura es obligatorio.");
  const invoicePath = input.invoicePath ? cleanText(input.invoicePath, 1000) : null;
  if (input.invoicePath && (!invoicePath || !invoicePath.startsWith(`${input.jobId}/invoice/`))) {
    return failure("La factura adjunta no es válida.");
  }

  const { data, error } = await (await createClient()).from("job_stages").update({
    status: "invoiced",
    invoice_number: invoiceNumber,
    invoice_path: invoicePath,
    invoiced_at: new Date().toISOString(),
    invoiced_by: profile.id,
  }).eq("id", input.stageId).eq("job_id", input.jobId).eq("status", "completed")
    .select("id").maybeSingle();
  if (error || !data) return failure("Sólo una etapa completada puede facturarse.");
  refresh(input.jobId);
  return { success: true, message: "Etapa facturada.", data: null };
}

export async function correctJobStageInvoice(input: {
  jobId: string;
  stageId: string;
  invoiceNumber: string;
  invoicePath?: string | null;
}): Promise<Result> {
  await requireSupervisor();
  if (!uuidPattern.test(input.jobId) || !uuidPattern.test(input.stageId)) return failure("La etapa no es válida.");
  const invoiceNumber = cleanText(input.invoiceNumber, 200);
  if (!invoiceNumber) return failure("El número de factura es obligatorio.");
  const invoicePath = input.invoicePath ? cleanText(input.invoicePath, 1000) : null;
  if (input.invoicePath && (!invoicePath || !invoicePath.startsWith(`${input.jobId}/invoice/`))) {
    return failure("La factura adjunta no es válida.");
  }
  const payload: Record<string, unknown> = { invoice_number: invoiceNumber };
  if (input.invoicePath !== undefined) payload.invoice_path = invoicePath;
  const { data, error } = await (await createClient()).from("job_stages").update(payload)
    .eq("id", input.stageId).eq("job_id", input.jobId).eq("status", "invoiced")
    .select("id").maybeSingle();
  if (error || !data) return failure("La factura sólo puede corregirse antes de registrar el pago.");
  refresh(input.jobId);
  return { success: true, message: "Factura de la etapa corregida.", data: null };
}

export async function payJobStage(input: { jobId: string; stageId: string }): Promise<Result> {
  const profile = await requireSupervisor();
  if (!uuidPattern.test(input.jobId) || !uuidPattern.test(input.stageId)) return failure("La etapa no es válida.");
  const { data, error } = await (await createClient()).from("job_stages")
    .update({ status: "paid", paid_at: new Date().toISOString(), paid_by: profile.id })
    .eq("id", input.stageId).eq("job_id", input.jobId).eq("status", "invoiced")
    .select("id").maybeSingle();
  if (error || !data) return failure("Sólo una etapa facturada puede marcarse como pagada.");
  refresh(input.jobId);
  return { success: true, message: "Pago de la etapa registrado.", data: null };
}
