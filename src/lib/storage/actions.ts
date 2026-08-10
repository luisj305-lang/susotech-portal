"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireProfile, requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { authorizeDownload, preparePhotoUpload, prepareProjectUpload } from "./core";
import { confirmBulkProjectUploadCore, prepareBulkProjectUploadCore, type BulkPrepareInput } from "./bulk-import-core";

type Bucket = "project-files" | "job-evidence";
type Result<T> = { success: true; message: string; data: T } | { success: false; message: string };

export async function createPhotoUploadUrl(input: {
  jobId: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; size: number;
}): Promise<Result<{ path: string; token: string; signedUrl: string }>> {
  await requireProfile();
  return preparePhotoUpload(await createClient(), input);
}

export async function createProjectUploadUrl(input: {
  jobId: string; fileName: string; mimeType: string; size: number;
}): Promise<Result<{ path: string; token: string; signedUrl: string }>> {
  await requireSupervisor();
  return prepareProjectUpload(await createClient(), input);
}

export async function createSignedDownloadUrl(input: {
  bucket: Bucket; path: string;
}): Promise<Result<{ signedUrl: string; expiresIn: number }>> {
  await requireProfile();
  return authorizeDownload(await createClient(), input);
}

export async function prepareBulkProjectUpload(input: BulkPrepareInput) {
  await requireSupervisor();
  return prepareBulkProjectUploadCore(await createClient(), input);
}

export async function confirmBulkProjectUpload(input: { itemId: string }) {
  await requireSupervisor();
  const result = await confirmBulkProjectUploadCore(await createClient(), input);
  if (result.success) revalidatePath("/trabajos");
  return result;
}
