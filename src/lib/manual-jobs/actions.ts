"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { composeManualJobPdf } from "./pdf";

type ActionResult = { success: boolean; message: string };

export async function createManualJob(input: {
  prismNumber: string;
  valueCents: number;
  workers: { technicianId: string; percentageBasisPoints: number }[];
  description?: string;
  workDate?: string;
  financialWeek?: string;
}): Promise<ActionResult> {
  try {
    const profile = await requireProfile();
    if (!["tecnico", "admin", "supervisor"].includes(profile.role)) {
      return { success: false, message: "No tienes permiso para registrar trabajos manuales." };
    }

    const supabase = await createClient();
    const { data: jobId, error } = await supabase.rpc("create_manual_job_v2", {
      p_prism_number: input.prismNumber,
      p_value_cents: input.valueCents,
      p_workers: input.workers,
      p_description: input.description || null,
      p_work_date: input.workDate || null,
      p_financial_week: input.financialWeek || null,
    });

    if (error) {
      return { success: false, message: error.message };
    }
    if (!jobId) {
      return { success: false, message: "No se pudo crear el trabajo manual." };
    }

    let pdfMessage: string | null = null;
    try {
      const workerIds = input.workers.map((worker) => worker.technicianId);
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", workerIds);
      if (profilesError) throw profilesError;
      const nameById = new Map(
        (profiles ?? []).map((worker) => [worker.id, worker.full_name?.trim() || worker.email]),
      );

      const pdf = await composeManualJobPdf({
        prismNumber: input.prismNumber.trim().toUpperCase(),
        valueCents: input.valueCents,
        creatorName: profile.full_name?.trim() || profile.email || "Técnico",
        dateLabel: new Intl.DateTimeFormat("es-US", {
          timeZone: "America/New_York",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date()),
        workers: input.workers.map((worker) => ({
          name: nameById.get(worker.technicianId) ?? "Técnico",
          percentageBasisPoints: worker.percentageBasisPoints,
          amountCents: Math.round((input.valueCents * worker.percentageBasisPoints) / 10000),
        })),
      });

      const path = `manual-jobs/${jobId}/revision-1.pdf`;
      const service = createServiceClient();
      const { error: uploadError } = await service.storage
        .from("project-files")
        .upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;

      const { error: setError } = await supabase.rpc("set_manual_job_pdf_path_v2", {
        p_manual_job_id: jobId,
        p_expected_revision: 1,
        p_pdf_path: path,
      });
      if (setError) throw setError;
    } catch {
      pdfMessage = "El trabajo se registró, pero no se pudo generar su PDF.";
    }

    revalidatePath("/manual");
    revalidatePath("/trabajos");
    revalidatePath("/dashboard");
    revalidatePath("/produccion");
    return {
      success: true,
      message: pdfMessage ?? "Trabajo manual enviado para aprobación.",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    return { success: false, message: "No se pudo enviar el trabajo manual." };
  }
}

export async function reviewManualJob(input: {
  id: string;
  approve: boolean;
  reason?: string;
}): Promise<ActionResult> {
  try {
    await requireSupervisor();

    const supabase = await createClient();
    const { error } = await supabase.rpc("review_manual_job", {
      p_manual_job_id: input.id,
      p_approve: input.approve,
      p_reason: input.reason ?? null,
    });

    if (error) {
      return { success: false, message: error.message };
    }

    revalidatePath("/manual");
    revalidatePath("/trabajos");
    revalidatePath("/dashboard");
    revalidatePath("/produccion");
    return {
      success: true,
      message: input.approve
        ? "Trabajo manual aprobado."
        : "Trabajo manual rechazado.",
    };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    return { success: false, message: "No se pudo procesar la revisión." };
  }
}

export async function updateManualJob(input: Parameters<typeof createManualJob>[0] & {
  id: string;
  expectedRevision: number;
}): Promise<ActionResult> {
  try {
    await requireSupervisor();
    const { error } = await (await createClient()).rpc("update_manual_job", {
      p_manual_job_id: input.id,
      p_expected_revision: input.expectedRevision,
      p_prism_number: input.prismNumber,
      p_value_cents: input.valueCents,
      p_workers: input.workers,
      p_description: input.description || null,
      p_work_date: input.workDate || null,
      p_financial_week: input.financialWeek || null,
    });
    if (error) return { success: false, message: error.message };
    revalidatePath("/manual");
    revalidatePath("/trabajos");
    revalidatePath("/dashboard");
    revalidatePath("/produccion");
    return { success: true, message: "Trabajo actualizado. Su estado de aprobación se conserva. El PDF anterior ya no está disponible como comprobante actual." };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    return { success: false, message: "No se pudo actualizar el trabajo manual." };
  }
}

export async function createManualJobPdfUrl(input: {
  id: string;
}): Promise<{ success: boolean; message: string; signedUrl?: string }> {
  try {
    await requireProfile();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("manual_jobs")
      .select("pdf_path, revision")
      .eq("id", input.id)
      .maybeSingle();
    if (error || !data?.pdf_path) {
      return { success: false, message: "El PDF aún no está disponible." };
    }

    const signed = await supabase.storage
      .from("project-files")
      .createSignedUrl(data.pdf_path, 60);
    if (signed.error || !signed.data) {
      return { success: false, message: "No se pudo generar el enlace del PDF." };
    }

    // A correction may have invalidated the receipt while the URL was signed.
    const current = await supabase.from("manual_jobs").select("pdf_path, revision").eq("id", input.id).maybeSingle();
    if (current.error || current.data?.pdf_path !== data.pdf_path || current.data?.revision !== data.revision) {
      return { success: false, message: "El trabajo cambió. El PDF anterior ya no es el comprobante actual." };
    }

    return { success: true, message: "", signedUrl: signed.data.signedUrl };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    return { success: false, message: "No se pudo abrir el PDF." };
  }
}
