"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSupervisor } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseRecruitmentUpdate } from "./core";

export async function updateRecruitmentApplication(formData: FormData): Promise<void> {
  await requireSupervisor();
  const update = parseRecruitmentUpdate(formData);
  if (!update) redirect("/postulantes?error=invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.from("recruitment_applications")
    .update({ status: update.status, internal_notes: update.internal_notes })
    .eq("id", update.id).eq("submission_state", "submitted").eq("updated_at", update.updated_at).select("id").maybeSingle();
  if (error) redirect(`/postulantes/${update.id}?error=save`);
  if (!data) redirect(`/postulantes/${update.id}?error=conflict`);
  revalidatePath("/postulantes");
  revalidatePath(`/postulantes/${update.id}`);
  redirect(`/postulantes/${update.id}?saved=1`);
}
