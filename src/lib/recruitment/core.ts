import { RECRUITMENT_STATUSES, type RecruitmentStatus } from "./types.ts";

export function isRecruitmentStatus(value: unknown): value is RecruitmentStatus {
  return typeof value === "string" && RECRUITMENT_STATUSES.some((status) => status === value);
}

export function isRecruitmentId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseRecruitmentUpdate(formData: FormData) {
  const id = formData.get("id");
  const status = formData.get("status");
  const notes = formData.get("internal_notes");
  const updatedAt = formData.get("updated_at");
  if (!isRecruitmentId(id) || !isRecruitmentStatus(status) || typeof notes !== "string" || notes.length > 10000
    || typeof updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt))) {
    return null;
  }
  return { id, status, internal_notes: notes.trim(), updated_at: updatedAt };
}
