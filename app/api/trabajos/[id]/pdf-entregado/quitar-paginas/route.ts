import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { removeDeliveredPdfPages } from "@/lib/jobs/delivered-pdf";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 120;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PAGES = 130;

function json(message: string, status: number, success = false) {
  return NextResponse.json({ success, message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await context.params;
  if (!uuidPattern.test(jobId)) return json("Trabajo no disponible.", 404);

  let input: { pages?: unknown; expectedPath?: unknown };
  try {
    input = await request.json();
  } catch {
    return json("La solicitud no es válida.", 400);
  }
  if (!input || !Array.isArray(input.pages) || !input.pages.length || input.pages.length > MAX_PAGES
    || input.pages.some((page) => !Number.isInteger(page) || page < 1 || page > MAX_PAGES)
    || typeof input.expectedPath !== "string" || !input.expectedPath.startsWith(`${jobId}/delivered/`)) {
    return json(`Selecciona entre 1 y ${MAX_PAGES} páginas válidas para eliminar.`, 400);
  }
  const pages = [...new Set(input.pages as number[])];

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return json("Debes iniciar sesión.", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", authData.user.id)
    .single();
  if (profileError || !profile?.is_active) return json("Acceso denegado.", 403);
  if (profile.role !== "admin" && profile.role !== "supervisor") {
    return json("Acceso denegado.", 403);
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("delivered_pdf_path, delivered_pdf_source_photo_ids, main_status, archived_at")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError || !job) return json("Trabajo no disponible.", 404);
  const deliveredPath = job.delivered_pdf_path;
  if (job.archived_at || !["asignado", "en_revision"].includes(job.main_status)) {
    return json("El trabajo no permite editar el PDF entregado.", 409);
  }
  if (!deliveredPath?.startsWith(`${jobId}/delivered/`)) {
    return json("Este trabajo no tiene un PDF entregado.", 409);
  }
  if (deliveredPath !== input.expectedPath) {
    return json("El PDF entregado cambió. Recarga las páginas antes de continuar.", 409);
  }

  const service = createServiceClient();
  const downloaded = await service.storage.from("project-files").download(deliveredPath);
  if (downloaded.error || !downloaded.data) {
    return json("No se pudo descargar el PDF entregado.", 409);
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());

  let trimmed: Uint8Array;
  try {
    trimmed = await removeDeliveredPdfPages(bytes, pages);
  } catch (error) {
    return json(error instanceof Error ? error.message : "No se pudieron eliminar las páginas.", 409);
  }

  const newPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  try {
    const { error: uploadError } = await service.storage.from("project-files").upload(
      newPath,
      Buffer.from(trimmed),
      {
        contentType: "application/pdf",
        upsert: false,
        cacheControl: "0",
        metadata: {
          generator: "susotech-portal",
          job_id: jobId,
          operation: "page-removal",
          expected_path: deliveredPath,
          removed_pages: pages.join(","),
          actor_id: authData.user.id,
        },
      },
    );
    if (uploadError) throw new Error("No se pudo guardar el PDF recortado.");
    const { error: updateError } = await supabase.rpc("remove_delivered_pdf_pages", {
      p_job_id: jobId,
      p_expected_path: deliveredPath,
      p_storage_path: newPath,
      p_source_photo_ids: job.delivered_pdf_source_photo_ids,
    });
    if (updateError) {
      // An RPC transport error may follow a successful commit. Keep both objects
      // on uncertain outcomes; deleting either can break a concurrent delivery.
      const { data: current, error: currentError } = await supabase.from("jobs")
        .select("delivered_pdf_path").eq("id", jobId).maybeSingle();
      if (currentError || current?.delivered_pdf_path !== newPath) {
        return json(updateError.message.includes("changed")
          ? "El PDF entregado cambió. Recarga las páginas antes de continuar."
          : "No se pudo verificar el cambio. Recarga el trabajo antes de volver a intentarlo.", 409);
      }
    }

    return json(
      `Se eliminaron ${pages.length} página(s) del PDF entregado.`,
      200,
      true,
    );
  } catch (error) {
    console.error("Delivered PDF page removal failed", error);
    return json(error instanceof Error ? error.message : "No se pudo recortar el PDF entregado.", 500);
  }
}
