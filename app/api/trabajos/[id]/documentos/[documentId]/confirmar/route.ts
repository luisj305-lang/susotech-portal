import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { inspectPdfDocument } from "@/lib/jobs/delivered-pdf";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function json(message: string, status: number, success = false) {
  return NextResponse.json({ success, message }, { status });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id: jobId, documentId } = await context.params;
  if (!uuidPattern.test(jobId) || !uuidPattern.test(documentId)) return json("El adjunto no es válido.", 404);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return json("Debes iniciar sesión.", 401);
  const { data: profile } = await supabase.from("profiles").select("role,is_active").eq("id", auth.user.id).maybeSingle();
  if (!profile?.is_active || profile.role !== "admin") return json("Acceso denegado.", 403);

  const service = createServiceClient();
  const { data: document, error: documentError } = await service.from("job_documents")
    .select("storage_path,file_hash,size_bytes")
    .eq("id", documentId).eq("job_id", jobId).eq("document_type", "additional")
    .is("deleted_at", null).maybeSingle();
  if (documentError || !document?.file_hash) return json("No se pudo consultar el adjunto.", 404);
  const downloaded = await service.storage.from("project-files").download(document.storage_path);
  if (downloaded.error || !downloaded.data) return json("No se pudo verificar el PDF privado.", 409);
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== document.size_bytes || hash !== document.file_hash) {
    return json("El PDF cargado no coincide con el archivo preparado.", 409);
  }
  let pageCount: number;
  try {
    pageCount = (await inspectPdfDocument(bytes)).pageCount;
  } catch {
    return json("PDFium no pudo validar el documento.", 422);
  }
  const { error } = await supabase.rpc("confirm_job_document_verified", {
    p_document_id: documentId, p_file_hash: hash, p_page_count: pageCount,
  });
  if (error) return json("No se pudo confirmar el adjunto.", 409);
  return json("Adjunto añadido.", 200, true);
}
