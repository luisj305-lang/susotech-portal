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
    const { data, error } = await createServiceClient().rpc("settle_due_hourly_shifts");
    const result = data?.[0] as { settled_count: number | string } | undefined;
    if (error || !result) {
      return Response.json({ error: "Hourly payroll settlement failed" }, { status: 500 });
    }
    return Response.json({
      settled: Number(result.settled_count),
    });
  } catch {
    return Response.json({ error: "Hourly payroll settlement failed" }, { status: 500 });
  }
}
