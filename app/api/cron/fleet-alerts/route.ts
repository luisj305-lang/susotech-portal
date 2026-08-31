import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await createServiceClient().rpc("generate_fleet_alerts");
    const result = data?.[0] as { generated_count: number | string; skipped_count: number | string } | undefined;
    if (error || !result) {
      return Response.json({ error: "Fleet alert generation failed" }, { status: 500 });
    }
    return Response.json({
      generated: Number(result.generated_count),
      skipped: Number(result.skipped_count),
    });
  } catch {
    return Response.json({ error: "Fleet alert generation failed" }, { status: 500 });
  }
}
