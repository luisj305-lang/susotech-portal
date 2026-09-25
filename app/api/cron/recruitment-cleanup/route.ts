import { cleanupExpiredRecruitment } from "@/lib/recruitment/cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    return Response.json(await cleanupExpiredRecruitment(), { headers });
  } catch { return Response.json({ error: "Recruitment cleanup failed" }, { status: 503, headers }); }
}
