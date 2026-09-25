export type ManualJobWorker = {
  technicianId: string;
  name: string;
  percentageBasisPoints: number;
  allocatedCents?: number;
};

export type ManualJob = {
  id: string;
  prism_number: string;
  value_cents: number;
  status: "pending" | "approved" | "rejected";
  created_by: string;
  creator_name?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  workers: ManualJobWorker[];
  rejection_reason?: string | null;
  pdf_path?: string | null;
  description?: string | null;
  work_date?: string | null;
  financial_week_start?: string | null;
  revision?: number | null;
};

export type ManualJobCreationContext = {
  first_financial_week: string;
  current_financial_week: string;
  today: string;
};

export type WeeklyManualEarning = {
  week_start: string;
  week_end_exclusive: string;
  approval_date: string;
  financial_date?: string;
  manual_job_id: string;
  prism_number: string;
  source_amount_cents: number;
  percentage_basis_points: number;
  allocated_cents: number;
  review_status: "approved";
};
