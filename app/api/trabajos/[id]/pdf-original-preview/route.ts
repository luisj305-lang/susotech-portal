import { renderOriginalPdfPreview } from "@/lib/jobs/delivered-pdf";
import { ensureVerifiedDocumentManifest } from "@/lib/jobs/document-manifest";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { getWorkShiftAccessForActor } from "@/lib/work-shifts/access";
import { ACTIVE_SHIFT_REQUIRED_MESSAGE } from "@/lib/work-shifts/types";
import {
  isOperationalFieldWorker,
  READ_ONLY_HELPER_MESSAGE,
} from "@/lib/auth/capabilities";

export const runtime = "nodejs";
export const maxDuration = 60;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  if (!uuidPattern.test(id) || !Number.isInteger(page)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new Response("Unauthorized", { status: 401 });
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, is_active, worker_specialty")
    .eq("id", user.user.id)
    .single();
  if (profileError || !profile?.is_active) return new Response("Forbidden", { status: 403 });
  if (profile.role === "tecnico" && !isOperationalFieldWorker(profile)) {
    return new Response(READ_ONLY_HELPER_MESSAGE, { status: 403 });
  }
  const access = await getWorkShiftAccessForActor({ id: profile.id, role: profile.role }, supabase);
  if (!access.active) return new Response(ACTIVE_SHIFT_REQUIRED_MESSAGE, { status: 403 });
  const { data: job, error: jobError } = await supabase.from("jobs").select("project_pdf_url").eq("id", id).maybeSingle();
  if (jobError) {
    return new Response(
      jobError.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : "Forbidden",
      { status: 403 },
    );
  }
  if (!job?.project_pdf_url?.startsWith(`${id}/`)) return new Response("Not found", { status: 404 });
  const service = createServiceClient();
  try {
    const sourceDocuments = await ensureVerifiedDocumentManifest(service, id, job.project_pdf_url);
    const totalPages = sourceDocuments.reduce((sum, document) => sum + Number(document.page_count), 0);
    if (page < 1 || page > totalPages) return new Response("Not found", { status: 404 });
    let offset = 0;
    const source = sourceDocuments.find((document) => {
      const start = offset + 1; offset += Number(document.page_count);
      return page >= start && page <= offset;
    });
    if (!source) return new Response("Not found", { status: 404 });
    const sourcePage = page - (offset - Number(source.page_count));
    const downloaded = await service.storage.from("project-files").download(source.storage_path);
    if (downloaded.error || !downloaded.data) return new Response("Unavailable", { status: 409 });
    const rendered = await renderOriginalPdfPreview(new Uint8Array(await downloaded.data.arrayBuffer()), sourcePage);
    const initialized = await supabase.rpc("initialize_job_pdf_draft_v3", {
      p_job_id: id,
      p_source_document_ids: sourceDocuments.map((document) => document.id),
      p_page_count: totalPages,
    });
    if (initialized.error) {
      return new Response(
        initialized.error.message.includes(ACTIVE_SHIFT_REQUIRED_MESSAGE) ? ACTIVE_SHIFT_REQUIRED_MESSAGE : "Forbidden",
        { status: 403 },
      );
    }
    return new Response(new Uint8Array(rendered.png), { headers: {
      "content-type": "image/png", "cache-control": "private, no-store",
      "x-page-count": String(totalPages), "x-draft-version": String(initialized.data?.[0]?.version ?? 0),
    } });
  } catch { return new Response("Invalid PDF", { status: 422 }); }
}
