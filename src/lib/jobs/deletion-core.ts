import type { SupabaseClient } from "@supabase/supabase-js";

export type JobDeletionCleanupRow = {
  queue_id: number;
  job_id?: string;
  bucket_id: "project-files" | "job-evidence";
  object_name: string;
};

type CleanupResult = {
  completed: number;
  pending: number;
};

const REMOVE_BATCH_SIZE = 100;

async function objectExists(
  supabase: SupabaseClient,
  row: JobDeletionCleanupRow,
): Promise<boolean> {
  try {
    const separator = row.object_name.lastIndexOf("/");
    const folder = separator === -1 ? "" : row.object_name.slice(0, separator);
    const fileName = row.object_name.slice(separator + 1);
    const { data, error } = await supabase.storage
      .from(row.bucket_id)
      .list(folder, { limit: 100, search: fileName });
    if (error) return true;
    return Boolean(data?.some((file) => file.name === fileName));
  } catch {
    return true;
  }
}

export async function cleanupJobDeletionQueue(
  supabase: SupabaseClient,
  rows: JobDeletionCleanupRow[],
): Promise<CleanupResult> {
  if (!rows.length) return { completed: 0, pending: 0 };

  const completedIds: number[] = [];
  const failedIds: number[] = [];
  const errors: string[] = [];

  for (const bucket of ["project-files", "job-evidence"] as const) {
    const bucketRows = rows.filter((row) => row.bucket_id === bucket);
    for (let index = 0; index < bucketRows.length; index += REMOVE_BATCH_SIZE) {
      const batch = bucketRows.slice(index, index + REMOVE_BATCH_SIZE);
      try {
        const { error } = await supabase.storage
          .from(bucket)
          .remove(batch.map((row) => row.object_name));
        if (error) errors.push(error.message);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Storage cleanup failed");
      }

      for (const row of batch) {
        if (await objectExists(supabase, row)) failedIds.push(row.queue_id);
        else completedIds.push(row.queue_id);
      }
    }
  }

  const { error: finishError } = await supabase.rpc("finish_job_deletion_cleanup", {
    p_completed_ids: completedIds,
    p_failed_ids: failedIds,
    p_error: errors.join("; ") || null,
  });
  if (finishError) {
    return { completed: 0, pending: rows.length };
  }

  return { completed: completedIds.length, pending: failedIds.length };
}
