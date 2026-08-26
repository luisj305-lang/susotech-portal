import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { composeDeliveredPdf } from "@/lib/jobs/delivered-pdf";
import { ensureVerifiedDocumentManifest } from "@/lib/jobs/document-manifest";
import { DEFAULT_CODE_COLOR, validatePlacements, type PdfCodePlacement } from "@/lib/jobs/pdf-code-editor-core";
import { validatePdfTextNotes, type PdfTextNote } from "@/lib/jobs/pdf-text-note-core";
import { validatePdfLines, type PdfLineAnnotation } from "@/lib/jobs/pdf-line-core";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_SHIFT_REQUIRED_MESSAGE } from "@/lib/work-shifts/types";
import {
  isOperationalFieldWorker,
  READ_ONLY_HELPER_MESSAGE,
} from "@/lib/auth/capabilities";

export const runtime = "nodejs";
export const maxDuration = 120;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_INPUT_BYTES = 120 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
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

  let input: { submit?: unknown; allocations?: unknown; allocationIdempotencyKey?: unknown };
  try {
    input = await request.json();
  } catch {
    return json("La solicitud no es válida.", 400);
  }
  if (typeof input.submit !== "boolean") return json("La solicitud no es válida.", 400);
  const allocations = Array.isArray(input.allocations) ? input.allocations : [];
  const validAllocations = allocations.length > 0 && allocations.length <= 100
    && allocations.every((item): item is { participantId: string; percentageBasisPoints: number } => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return typeof value.participantId === "string" && uuidPattern.test(value.participantId)
        && Number.isInteger(value.percentageBasisPoints)
        && Number(value.percentageBasisPoints) > 0 && Number(value.percentageBasisPoints) <= 10000;
    })
    && new Set(allocations.map((item) => (item as { participantId: string }).participantId)).size === allocations.length
    && allocations.reduce((sum, item) => sum + Number((item as { percentageBasisPoints: number }).percentageBasisPoints), 0) === 10000;
  if (input.submit && (!validAllocations || typeof input.allocationIdempotencyKey !== "string"
    || !uuidPattern.test(input.allocationIdempotencyKey))) {
    return json("La distribución financiera debe sumar exactamente 100.00%.", 400);
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return json("Debes iniciar sesión.", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, is_active, worker_specialty, price_category_id")
    .eq("id", authData.user.id)
    .single();
  if (profileError || !profile?.is_active) return json("Acceso denegado.", 403);
  if (profile.role === "tecnico" && !isOperationalFieldWorker(profile)) {
    return json(READ_ONLY_HELPER_MESSAGE, 403);
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, main_status, project_pdf_url, delivered_pdf_path")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError || !job) return jobError?.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? json(ACTIVE_SHIFT_REQUIRED_MESSAGE, 403)
    : json("Trabajo no disponible.", 404);

  const isTechnician = profile.role === "tecnico";
  const isAdmin = profile.role === "admin";
  if (isTechnician && (!input.submit || !["asignado", "en_revision"].includes(job.main_status))) {
    return json("Solo puedes entregar un trabajo asignado o en revisión.", 409);
  }
  if (isAdmin && (input.submit || !["asignado", "en_revision"].includes(job.main_status))) {
    return json("El PDF solo puede regenerarse mientras el trabajo sea editable.", 409);
  }
  if (!isTechnician && !isAdmin) return json("Acceso denegado.", 403);
  if (isTechnician && !profile.price_category_id) {
    return json("Tu categoría de precio no está configurada. Contacta a un administrador.", 409);
  }
  if (!job.project_pdf_url?.startsWith(`${jobId}/`)) {
    return json("Este trabajo no tiene un PDF original válido.", 409);
  }

  const service = createServiceClient();
  let verifiedDocuments;
  try {
    verifiedDocuments = await ensureVerifiedDocumentManifest(service, jobId, job.project_pdf_url);
  } catch (error) {
    return json(error instanceof Error ? error.message : "No se pudieron verificar los PDFs fuente.", 409);
  }
  const [{ data: draft, error: draftError }, { data: catalog, error: catalogError }, { data: documents, error: documentsError }] = await Promise.all([
    supabase.from("job_pdf_drafts").select("version,source_page_count,source_document_ids,placements,text_notes,lines").eq("job_id", jobId).maybeSingle(),
    service.from("production_code_catalog").select("id,code,unit").eq("is_active", true),
    supabase.from("job_documents").select("id,storage_path,file_hash,page_count,position,document_type")
      .eq("job_id", jobId).eq("status", "active").is("deleted_at", null)
      .eq("verification_status", "pdf_verified").order("position", { ascending: true }).order("created_at", { ascending: true }),
  ]);
  if (draftError || !draft || catalogError || documentsError) return draftError?.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? json(ACTIVE_SHIFT_REQUIRED_MESSAGE, 403)
    : json("Abre el editor y guarda el borrador antes de entregar.", 409);
  const placements = draft.placements as PdfCodePlacement[];
  const placementError = validatePlacements(placements, draft.source_page_count);
  if (placementError) return json(placementError, 409);
  const catalogById = new Map((catalog ?? []).map((item) => [item.id, item.code]));
  if (placements.some((item) => item.entries.some((entry) => !catalogById.has(entry.catalogId)))) return json("El borrador contiene un código no disponible.", 409);
  const catalogUnits = new Map((catalog ?? []).map((item) => [item.id, item.unit]));
  if (placements.some((item) => item.entries.some((entry) => ["fixed", "event"].includes(catalogUnits.get(entry.catalogId) ?? "") && !Number.isInteger(entry.quantity)))) {
    return json("Los códigos de cantidad fija o evento requieren un entero mayor que cero.", 409);
  }
  if (isTechnician) {
    const catalogIds = [...new Set(placements.flatMap((item) => item.entries.map((entry) => entry.catalogId)))];
    const effectiveDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const { data: rates, error: ratesError } = await service
      .from("production_code_rates")
      .select("catalog_item_id")
      .eq("price_category_id", profile.price_category_id)
      .eq("active", true)
      .lte("effective_from", effectiveDate)
      .in("catalog_item_id", catalogIds);
    const ratedIds = new Set((rates ?? []).map((rate) => rate.catalog_item_id));
    if (ratesError || catalogIds.some((catalogId) => !ratedIds.has(catalogId))) {
      return json("El borrador contiene un código sin tarifa configurada para tu categoría.", 409);
    }
  }
  const sourceDocuments = documents?.length ? documents : verifiedDocuments;
  if (!sourceDocuments.length || !sourceDocuments.some((document) => document.document_type === "original")
    || sourceDocuments.some((document) => !document.file_hash || !document.page_count)
    || sourceDocuments.map((document) => document.id).join(",") !== (draft.source_document_ids ?? []).join(",")) {
    return json("Los PDFs fuente cambiaron. Vuelve a abrir el editor antes de entregar.", 409);
  }
  const textNotes = draft.text_notes as PdfTextNote[];
  const textNoteError = validatePdfTextNotes(textNotes, sourceDocuments.map((document) => ({
    id: document.id,
    pageCount: Number(document.page_count),
  })));
  if (textNoteError) return json("El borrador contiene una nota de texto inválida.", 409);
  const lines = (draft.lines ?? []) as PdfLineAnnotation[];
  const lineError = validatePdfLines(lines, sourceDocuments.map((document) => ({
    id: document.id,
    pageCount: Number(document.page_count),
  })));
  if (lineError) return json("El borrador contiene una línea inválida.", 409);

  const { data: photos, error: photoError } = await supabase
    .from("job_photos")
    .select("id, storage_path, uploaded_by, created_at, comment")
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (photoError) return photoError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
    ? json(ACTIVE_SHIFT_REQUIRED_MESSAGE, 403)
    : json("No se pudieron consultar las evidencias.", 500);
  if (!photos?.length) return json("Agregue al menos una evidencia antes de entregar.", 409);
  if (photos.length > MAX_PHOTOS) return json(`El máximo es ${MAX_PHOTOS} evidencias por entrega.`, 409);
  if (photos.some((photo) => !photo.storage_path.startsWith(`${jobId}/`))) {
    return json("Una evidencia tiene una ruta inválida.", 409);
  }

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

    const sourceBytes: { id: string; bytes: Uint8Array }[] = [];
    let totalBytes = 0;
    for (const document of sourceDocuments) {
      const bytes = await downloadPrivateObject(service, "project-files", document.storage_path);
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error("Un PDF fuente supera el límite de 25 MB.");
      if (createHash("sha256").update(bytes).digest("hex") !== document.file_hash) {
        throw new Error("Un PDF fuente no coincide con su hash verificado.");
      }
      totalBytes += bytes.length;
      if (totalBytes > MAX_INPUT_BYTES) throw new Error("Los documentos de entrada superan el límite de 120 MB.");
      sourceBytes.push({ id: document.id, bytes });
    }
    const photoBytes: Uint8Array[] = [];
    for (const photo of photos) {
      const bytes = await downloadPrivateObject(service, "job-evidence", photo.storage_path);
      if (bytes.length > MAX_PHOTO_BYTES) throw new Error("Una evidencia supera el límite de 10 MB.");
      totalBytes += bytes.length;
      if (totalBytes > MAX_INPUT_BYTES) throw new Error("Los documentos de entrada superan el límite de 120 MB.");
      photoBytes.push(bytes);
    }

    const delivered = await composeDeliveredPdf(
      sourceBytes,
      photos.map((photo, index) => ({
        id: photo.id,
        bytes: photoBytes[index],
        createdAt: photo.created_at,
        technicianName: uploaderNames.get(photo.uploaded_by) ?? null,
        comment: photo.comment,
      })),
      placements.map((item) => ({
        ...item,
        color: item.color ?? DEFAULT_CODE_COLOR,
        entries: item.entries.map((entry) => ({ code: catalogById.get(entry.catalogId)!, quantity: entry.quantity })),
      })),
      textNotes,
      lines.map(({ page, points, color }) => ({ page, points, color })),
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
          source_document_ids: delivered.sourceDocumentIds.join(","),
          snapshot_hash: createHash("sha256").update(JSON.stringify(placements)).digest("hex"),
          text_note_snapshot_hash: createHash("sha256").update(JSON.stringify(textNotes)).digest("hex"),
        },
      },
    );
    if (uploadError) throw new Error("No se pudo guardar el PDF entregado.");
    uploaded = true;

    const { data: confirmation, error: confirmationError } = await supabase.rpc(
      input.submit ? "confirm_delivered_job_pdf_with_allocations_v3" : "confirm_delivered_job_pdf_complete_v3",
      {
        p_job_id: jobId,
        p_storage_path: deliveredPath,
        p_source_photo_ids: delivered.sourcePhotoIds,
        p_source_document_ids: delivered.sourceDocumentIds,
        p_submit: input.submit,
        p_expected_draft_version: draft.version,
        p_snapshot_hash: createHash("sha256").update(JSON.stringify(placements)).digest("hex"),
        p_text_note_snapshot: textNotes,
        ...(input.submit ? {
          p_allocations: allocations,
          p_allocation_idempotency_key: input.allocationIdempotencyKey,
        } : {}),
      },
    );

    let confirmed = !confirmationError;
    const previousPath = confirmation?.[0]?.previous_storage_path as string | null | undefined;
    if (confirmationError) {
      // A transport failure can be ambiguous: never delete an object that may
      // already be the committed pointer.
      const { data: current, error: currentError } = await supabase
        .from("jobs")
        .select("delivered_pdf_path")
        .eq("id", jobId)
        .maybeSingle();
      if (currentError) {
        uploaded = false;
        throw new Error(
          confirmationError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
            || currentError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)
          ? ACTIVE_SHIFT_REQUIRED_MESSAGE
          : "No se pudo verificar la confirmación del PDF entregado.",
        );
      }
      confirmed = current?.delivered_pdf_path === deliveredPath;
      if (!confirmed) {
        if (confirmationError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE)) {
          throw new Error(ACTIVE_SHIFT_REQUIRED_MESSAGE);
        }
        throw new Error("No se pudo confirmar el PDF entregado.");
      }
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
    const message = error instanceof Error ? error.message : "No se pudo generar el PDF entregado.";
    return json(message, message === ACTIVE_SHIFT_REQUIRED_MESSAGE ? 403 : 500);
  }
}
