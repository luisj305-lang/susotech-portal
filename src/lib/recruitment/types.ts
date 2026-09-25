export const RECRUITMENT_STATUSES = ["new", "contacted", "interview", "hired", "rejected"] as const;
export type RecruitmentStatus = (typeof RECRUITMENT_STATUSES)[number];
export const RECRUITMENT_STATUS_LABELS: Record<RecruitmentStatus, string> = {
  new: "Nuevo", contacted: "Contactado", interview: "Entrevista", hired: "Contratado", rejected: "Descartado",
};
export const RECRUITMENT_RESUME_BUCKET = "recruitment-resumes";
export const RECRUITMENT_MAX_RESUME_BYTES = 10 * 1024 * 1024;

export type RecruitmentApplication = {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  postal_code: string;
  position: string;
  start_date: string;
  can_travel: boolean;
  available_weekends: boolean;
  experience_details: string;
  has_license: boolean;
  license_type: string | null;
  certifications: string;
  additional_comments: string;
  resume_path: string | null;
  resume_name: string | null;
  resume_size: number | null;
  status: RecruitmentStatus;
  internal_notes: string;
  created_at: string;
  submitted_at: string;
  updated_at: string;
};
export type RecruitmentListResult = {
  applications: RecruitmentApplication[];
  total: number;
  page: number;
  pageSize: number;
};

export type LegacyRecruitmentApplication = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  experience: string | null;
  message: string | null;
  created_at: string;
};

export type LegacyRecruitmentListResult = {
  applications: LegacyRecruitmentApplication[];
  total: number;
  page: number;
  pageSize: number;
};
