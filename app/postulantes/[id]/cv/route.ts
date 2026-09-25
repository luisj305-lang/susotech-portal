import { requireOfficeViewer } from "@/lib/auth/session";
import { getRecruitmentResumeUrl } from "@/lib/recruitment/queries";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireOfficeViewer();
  const { id } = await params;
  const url = await getRecruitmentResumeUrl(id);
  if (!url) return new Response("Hoja de vida no disponible.", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
