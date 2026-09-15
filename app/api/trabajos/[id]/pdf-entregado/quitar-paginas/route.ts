import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { inspectPdfDocument, removeDeliveredPdfPages } from "@/lib/jobs/delivered-pdf";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 120;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PAGES = 100;

function json(message: string, status: number, success = false) {
  return NextResponse.json({ success, message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await context.params;
  if (!uuidPattern.test(jobId)) return json("Trabajo no disponible.", 404);

  let input: { pages?: unknown };
  try {
    input = await request.json();
  } catch {
    return json("La solicitud no es válida.", 400);
  }
  const pages = Array.isArray(input.pages)
    ? [...new Set(input.pages.filter((page): page is number => Number.isInteger(page) && (page as number) >= 1))]
    : [];
  if (!pages.length || pages.length > MAX_PAGES) {
    return json(`Selecciona entre 1 y ${MAX_PAGES} páginas válidas para eliminar.`, 400);
  }

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
    .select("delivered_pdf_path, delivered_pdf_source_photo_ids")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError || !job) return json("Trabajo no disponible.", 404);
  const deliveredPath = job.delivered_pdf_path;
  if (!deliveredPath?.startsWith(`${jobId}/`)) {
    return json("Este trabajo no tiene un PDF entregado.", 409);
  }

  const service = createServiceClient();
  const downloaded = await service.storage.from("project-files").download(deliveredPath);
  if (downloaded.error || !downloaded.data) {
    return json("No se pudo descargar el PDF entregado.", 409);
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());

  let totalPages: number;
  try {
    totalPages = (await inspectPdfDocument(bytes)).pageCount;
  } catch {
    return json("El PDF entregado no es válido.", 409);
  }
  if (pages.some((page) => page > totalPages)) {
    return json(`El PDF entregado tiene ${totalPages} página(s).`, 400);
  }

  // Evidence pages sit after the original pages. Map any removed evidence page
  // back to the photo it was rendered from so the snapshot stays consistent.
  const snapshotPhotoIds = (job.delivered_pdf_source_photo_ids ?? []) as string[];
  let photoOrder: string[] = [];
  if (snapshotPhotoIds.length) {
    const { data: photos } = await supabase
      .from("job_photos")
      .select("id")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .in("id", snapshotPhotoIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    photoOrder = (photos ?? []).map((photo) => photo.id);
  }
  const originalPageCount = Math.max(0, totalPages - snapshotPhotoIds.length);
  const removedPhotoIds = new Set<string>();
  for (const page of pages) {
    if (page <= originalPageCount) continue;
    const evidenceIndex = page - originalPageCount;
    const photoId = photoOrder[evidenceIndex - 1];
    if (photoId) removedPhotoIds.add(photoId);
  }
  const newSnapshotPhotoIds = snapshotPhotoIds.filter((photoId) => !removedPhotoIds.has(photoId));

  let trimmed: Uint8Array;
  try {
    trimmed = await removeDeliveredPdfPages(bytes, pages);
  } catch (error) {
    return json(error instanceof Error ? error.message : "No se pudieron eliminar las páginas.", 409);
  }

  const newPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  let uploaded = false;
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
        },
      },
    );
    if (uploadError) throw new Error("No se pudo guardar el PDF recortado.");
    uploaded = true;

    const { error: updateError } = await supabase.rpc("remove_delivered_pdf_pages", {
      p_job_id: jobId,
      p_expected_path: deliveredPath,
      p_storage_path: newPath,
      p_source_photo_ids: newSnapshotPhotoIds,
    });
    if (updateError) {
      throw new Error(
        updateError.message.includes("changed")
          ? "El PDF entregado cambió mientras editabas. Recarga e inténtalo de nuevo."
          : "No se pudo actualizar el PDF entregado.",
      );
    }

    uploaded = false;
    await service.storage.from("project-files").remove([deliveredPath]);

    return json(
      `Se eliminaron ${pages.length} página(s) del PDF entregado.`,
      200,
      true,
    );
  } catch (error) {
    if (uploaded) await service.storage.from("project-files").remove([newPath]);
    console.error("Delivered PDF page removal failed", error);
    return json(error instanceof Error ? error.message : "No se pudo recortar el PDF entregado.", 500);
  }
}
