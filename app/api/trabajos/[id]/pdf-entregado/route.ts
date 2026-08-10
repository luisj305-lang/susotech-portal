import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { composeDeliveredPdf } from "@/lib/jobs/delivered-pdf";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_INPUT_BYTES = 120 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS = 30;

function json(message: string, status: number, success = false) {
  return NextResponse.json({ success, message }, { status });
}

async function downloadPrivateObject(
  service: ReturnType<typeof createServiceClient>,
  bucket: "project-files" | "job-evidence",
  storagePath: string,
) {
  const { data, error } = await service.storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error(`No se pudo descargar un objeto privado de ${bucket}.`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await context.params;
  if (!uuidPattern.test(jobId)) return json("Trabajo no disponible.", 404);

  let input: { submit?: unknown };
  try {
    input = await request.json();
  } catch {
    return json("La solicitud no es válida.", 400);
  }
  if (typeof input.submit !== "boolean") return json("La solicitud no es válida.", 400);

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return json("Debes iniciar sesión.", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", authData.user.id)
    .single();
  if (profileError || !profile?.is_active) return json("Acceso denegado.", 403);

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, main_status, project_pdf_url, delivered_pdf_path")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError || !job) return json("Trabajo no disponible.", 404);

  const isTechnician = profile.role === "tecnico";
  const isOffice = profile.role === "admin" || profile.role === "supervisor";
  if (isTechnician && (!input.submit || job.main_status !== "en_progreso")) {
    return json("Solo puedes entregar un trabajo en progreso.", 409);
  }
  if (isOffice && (input.submit || !["en_progreso", "enviado_revision"].includes(job.main_status))) {
    return json("El PDF solo puede regenerarse mientras el trabajo sea editable.", 409);
  }
  if (!isTechnician && !isOffice) return json("Acceso denegado.", 403);
  if (!job.project_pdf_url?.startsWith(`${jobId}/`)) {
    return json("Este trabajo no tiene un PDF original válido.", 409);
  }

  const { data: photos, error: photoError } = await supabase
    .from("job_photos")
    .select("id, storage_path, uploaded_by, created_at, comment")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (photoError) return json("No se pudieron consultar las evidencias.", 500);
  if (!photos?.length) return json("Agregue al menos una evidencia antes de entregar.", 409);
  if (photos.length > MAX_PHOTOS) return json(`El máximo es ${MAX_PHOTOS} evidencias por entrega.`, 409);
  if (photos.some((photo) => !photo.storage_path.startsWith(`${jobId}/`))) {
    return json("Una evidencia tiene una ruta inválida.", 409);
  }

  const service = createServiceClient();
  const deliveredPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  let uploaded = false;
  try {
    const uploaderIds = [...new Set(photos.map((photo) => photo.uploaded_by))];
    const { data: uploaders, error: uploadersError } = await service
      .from("profiles")
      .select("id, full_name, email")
      .in("id", uploaderIds);
    if (uploadersError) throw new Error("No se pudieron consultar los autores de las evidencias.");
    const uploaderNames = new Map(
      (uploaders ?? []).map((uploader) => [uploader.id, uploader.full_name?.trim() || uploader.email]),
    );

    const originalPdf = await downloadPrivateObject(service, "project-files", job.project_pdf_url);
    if (originalPdf.length > MAX_ORIGINAL_BYTES) throw new Error("El PDF original supera el límite de 25 MB.");
    let totalBytes = originalPdf.length;
    const photoBytes: Uint8Array[] = [];
    for (const photo of photos) {
      const bytes = await downloadPrivateObject(service, "job-evidence", photo.storage_path);
      if (bytes.length > MAX_PHOTO_BYTES) throw new Error("Una evidencia supera el límite de 10 MB.");
      totalBytes += bytes.length;
      if (totalBytes > MAX_INPUT_BYTES) throw new Error("Los documentos de entrada superan el límite de 120 MB.");
      photoBytes.push(bytes);
    }

    const delivered = await composeDeliveredPdf(
      originalPdf,
      photos.map((photo, index) => ({
        id: photo.id,
        bytes: photoBytes[index],
        createdAt: photo.created_at,
        technicianName: uploaderNames.get(photo.uploaded_by) ?? null,
        comment: photo.comment,
      })),
    );

    const { error: uploadError } = await service.storage.from("project-files").upload(
      deliveredPath,
      Buffer.from(delivered.bytes),
      {
        contentType: "application/pdf",
        upsert: false,
        cacheControl: "0",
        metadata: {
          generator: "susotech-portal",
          job_id: jobId,
          source_photo_ids: delivered.sourcePhotoIds.join(","),
        },
      },
    );
    if (uploadError) throw new Error("No se pudo guardar el PDF entregado.");
    uploaded = true;

    const { data: confirmation, error: confirmationError } = await supabase.rpc(
      "confirm_delivered_job_pdf",
      {
        p_job_id: jobId,
        p_storage_path: deliveredPath,
        p_source_photo_ids: delivered.sourcePhotoIds,
        p_submit: input.submit,
      },
    );

    let confirmed = !confirmationError;
    const previousPath = confirmation?.[0]?.previous_storage_path as string | null | undefined;
    if (confirmationError) {
      // A transport failure can be ambiguous: never delete an object that may
      // already be the committed pointer.
      const { data: current } = await supabase
        .from("jobs")
        .select("delivered_pdf_path")
        .eq("id", jobId)
        .maybeSingle();
      confirmed = current?.delivered_pdf_path === deliveredPath;
      if (!confirmed) throw new Error("No se pudo confirmar el PDF entregado.");
    }

    uploaded = false;
    if (previousPath && previousPath !== deliveredPath && previousPath !== job.project_pdf_url) {
      // The pointer already references the new valid object. Old-file cleanup is
      // intentionally best effort and cannot invalidate the delivery.
      await service.storage.from("project-files").remove([previousPath]);
    }

    return json(
      input.submit ? "Trabajo entregado con su PDF final." : "PDF entregado regenerado.",
      200,
      true,
    );
  } catch (error) {
    if (uploaded) await service.storage.from("project-files").remove([deliveredPath]);
    console.error("Delivered PDF generation failed", error);
    return json(
      error instanceof Error ? error.message : "No se pudo generar el PDF entregado.",
      500,
    );
  }
}
