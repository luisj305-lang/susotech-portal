import { renderDeliveredPdfPreview } from "@/lib/jobs/delivered-pdf";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 120;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  if (!uuidPattern.test(id) || !Number.isInteger(page)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return new Response("Unauthorized", { status: 401 });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", authData.user.id)
    .single();
  if (profileError || !profile?.is_active) return new Response("Forbidden", { status: 403 });
  if (profile.role !== "admin" && profile.role !== "supervisor") {
    return new Response("Forbidden", { status: 403 });
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("delivered_pdf_path")
    .eq("id", id)
    .maybeSingle();
  if (jobError) return new Response("Forbidden", { status: 403 });
  if (!job?.delivered_pdf_path?.startsWith(`${id}/`)) return new Response("Not found", { status: 404 });

  const service = createServiceClient();
  const downloaded = await service.storage.from("project-files").download(job.delivered_pdf_path);
  if (downloaded.error || !downloaded.data) return new Response("Unavailable", { status: 409 });

  try {
    const rendered = await renderDeliveredPdfPreview(
      new Uint8Array(await downloaded.data.arrayBuffer()),
      page,
    );
    return new Response(new Uint8Array(rendered.png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-page-count": String(rendered.pageCount),
      },
    });
  } catch {
    return new Response("Invalid PDF", { status: 422 });
  }
}
