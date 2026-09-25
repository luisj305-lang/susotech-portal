import { flattenSourceDocuments } from "@/lib/jobs/delivered-pdf";
import {
  downloadVerifiedSourceDocuments,
  ensureVerifiedDocumentManifest,
} from "@/lib/jobs/document-manifest";
import {
  parseJobPdfViewKind,
  PDF_VIEWER_SIGNED_URL_TTL_SECONDS,
  resolveJobPdfViewStoragePath,
} from "@/lib/jobs/pdf-view-core";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ACTIVE_SHIFT_REQUIRED_MESSAGE } from "@/lib/work-shifts/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function response(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; kind: string }> },
) {
  const { id: jobId, kind: rawKind } = await context.params;
  const kind = parseJobPdfViewKind(rawKind);
  if (!uuidPattern.test(jobId) || !kind) return response("Not found", 404);

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return response("Unauthorized", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, is_active")
    .eq("id", authData.user.id)
    .single();
  if (profileError || !profile?.is_active) return response("Forbidden", 403);

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("project_pdf_url, delivered_pdf_path")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) {
    return response(
      jobError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : "Forbidden",
      403,
    );
  }
  if (!job) return response("Not found", 404);

  const storagePath = resolveJobPdfViewStoragePath(jobId, kind, job);
  if (!storagePath) return response("Not found", 404);

  const service = createServiceClient();
  if (kind === "delivered") {
    const signed = await service.storage
      .from("project-files")
      .createSignedUrl(storagePath, PDF_VIEWER_SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data) return response("Unavailable", 409);
    return new Response(null, {
      status: 302,
      headers: {
        location: signed.data.signedUrl,
        "cache-control": "private, no-store",
      },
    });
  }

  try {
    const sourceDocuments = await ensureVerifiedDocumentManifest(service, jobId, storagePath);
    const sources = await downloadVerifiedSourceDocuments(service, sourceDocuments);
    const flattened = await flattenSourceDocuments(sources);
    return new Response(new Uint8Array(flattened.bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="job-${jobId}-compatible.pdf"`,
        "cache-control": "private, no-store",
        "content-length": String(flattened.bytes.length),
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return response("Unable to prepare the PDF.", 422);
  }
}
