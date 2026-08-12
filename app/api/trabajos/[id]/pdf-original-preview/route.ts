import { renderOriginalPdfPreview } from "@/lib/jobs/delivered-pdf";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

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
  const { data: job } = await supabase.from("jobs").select("project_pdf_url").eq("id", id).maybeSingle();
  if (!job?.project_pdf_url?.startsWith(`${id}/`)) return new Response("Not found", { status: 404 });
  const service = createServiceClient();
  const downloaded = await service.storage.from("project-files").download(job.project_pdf_url);
  if (downloaded.error || !downloaded.data) return new Response("Unavailable", { status: 409 });
  try {
    const rendered = await renderOriginalPdfPreview(new Uint8Array(await downloaded.data.arrayBuffer()), page);
    const initialized = await supabase.rpc("initialize_job_pdf_draft", { p_job_id: id, p_page_count: rendered.pageCount });
    if (initialized.error) return new Response("Forbidden", { status: 403 });
    return new Response(new Uint8Array(rendered.png), { headers: {
      "content-type": "image/png", "cache-control": "private, no-store",
      "x-page-count": String(rendered.pageCount), "x-draft-version": String(initialized.data?.[0]?.version ?? 0),
    } });
  } catch { return new Response("Invalid PDF", { status: 422 }); }
}
