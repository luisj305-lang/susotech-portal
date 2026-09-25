import "server-only";

import { requireOfficeViewer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isRecruitmentId, isRecruitmentStatus } from "./core";
import { RECRUITMENT_RESUME_BUCKET, type RecruitmentApplication, type RecruitmentListResult, type LegacyRecruitmentApplication, type LegacyRecruitmentListResult } from "./types";

// Explicit projection intentionally excludes public submission credentials.
const applicationColumns = "id,full_name,phone,email,city,state,postal_code,position,start_date,can_travel,available_weekends,experience_details,has_license,license_type,certifications,additional_comments,resume_path,resume_name,resume_size,status,internal_notes,created_at,submitted_at,updated_at";

export async function listRecruitmentApplications(filters: { status?: string; page?: number } = {}): Promise<RecruitmentListResult> {
  await requireOfficeViewer();
  const supabase = await createClient();
  const page = Number.isSafeInteger(filters.page) && filters.page! > 0 ? Math.min(filters.page!, 100000) : 1;
  const pageSize = 25;
  let query = supabase.from("recruitment_applications").select(applicationColumns, { count: "exact" }).eq("submission_state", "submitted");
  if (isRecruitmentStatus(filters.status)) query = query.eq("status", filters.status);
  const { data, error, count } = await query.order("submitted_at", { ascending: false }).order("id").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error("No se pudieron cargar los postulantes.");
  return { applications: (data ?? []) as RecruitmentApplication[], total: count ?? 0, page, pageSize };
}

export async function getRecruitmentApplication(id: string): Promise<RecruitmentApplication | null> {
  await requireOfficeViewer();
  if (!isRecruitmentId(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("recruitment_applications").select(applicationColumns).eq("id", id).eq("submission_state", "submitted").maybeSingle();
  if (error) throw new Error("No se pudo cargar la solicitud.");
  return data as RecruitmentApplication | null;
}

export async function getRecruitmentResumeUrl(id: string): Promise<string | null> {
  const application = await getRecruitmentApplication(id);
  if (!application?.resume_path || application.resume_path !== `${id}/resume.pdf`) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(RECRUITMENT_RESUME_BUCKET).createSignedUrl(application.resume_path, 60, { download: "hoja-de-vida.pdf" });
  if (error) throw new Error("No se pudo abrir la hoja de vida.");
  return data.signedUrl;
}

export async function listLegacyRecruitmentApplications(filters: { page?: number } = {}): Promise<LegacyRecruitmentListResult> {
  await requireOfficeViewer();
  const supabase = await createClient();
  const page = Number.isSafeInteger(filters.page) && filters.page! > 0 ? Math.min(filters.page!, 100000) : 1;
  const pageSize = 25;
  const { data, error, count } = await supabase.from("job_applications")
    .select("id,full_name,phone,email,position,experience,message,created_at", { count: "exact" })
    .order("created_at", { ascending: false }).order("id").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error("No se pudieron cargar las solicitudes anteriores.");
  return { applications: (data ?? []) as LegacyRecruitmentApplication[], total: count ?? 0, page, pageSize };
}
