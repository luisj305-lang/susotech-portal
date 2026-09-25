import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { RESUME_BUCKET } from "./public-input";

export async function cleanupExpiredRecruitment(): Promise<{ removed: number }> {
  const db = createServiceClient();
  // Wait beyond the upload token's two-hour validity before removing reservations.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stale = await db.from("recruitment_applications").select("id,resume_path")
    .eq("submission_state", "pending").lt("submission_expires_at", cutoff)
    .order("submission_expires_at").limit(50);
  if (stale.error) throw new Error("Cleanup lookup failed");
  const rows = stale.data ?? [];
  if (!rows.length) return { removed: 0 };
  const paths = rows.map(row => row.resume_path).filter((path): path is string => typeof path === "string");
  if (paths.length) {
    const removed = await db.storage.from(RESUME_BUCKET).remove(paths);
    if (removed.error) throw new Error("Storage cleanup failed");
  }
  const removedRows = await db.from("recruitment_applications").delete().in("id", rows.map(row => row.id))
    .eq("submission_state", "pending").lt("submission_expires_at", cutoff).select("id");
  if (removedRows.error) throw new Error("Reservation cleanup failed");
  return { removed: removedRows.data?.length ?? 0 };
}
