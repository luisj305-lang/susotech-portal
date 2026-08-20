export type JobStatus =
  | "sin_asignar"
  | "asignado"
  | "en_revision"
  | "aprobado"
  | "facturado"
  | "pagado";

export type IncidentType =
  | "need_splicing"
  | "no_access"
  | "need_cr"
  | "permit_pending"
  | "returned"
  | "incomplete";

export type AssigneeType = "technician" | "crew";

export type JobCategory = "categoria_1" | "categoria_2" | "categoria_3";

export type ArchiveReasonCode =
  | "duplicate_job"
  | "cancelled_by_client_or_office"
  | "incorrect_address_or_data"
  | "no_access_or_blocked_conditions"
  | "out_of_scope";

export interface Job {
  id: string;
  prism_number: string | null;
  njuns_number: string | null;
  title: string | null;
  address: string | null;
  location: string | null;
  customer_name: string | null;
  request_date: string | null;
  job_type: string | null;
  description: string | null;
  special_instructions: string | null;
  required_material: string | null;
  category: JobCategory;
  main_status: JobStatus;
  incident: IncidentType | null;
  incident_notes: string | null;
  comments: string | null;
  estimated_total: number | null;
  project_map_url: string | null;
  project_pdf_url: string | null;
  delivered_pdf_path: string | null;
  delivered_pdf_generated_at: string | null;
  delivered_pdf_generated_by: string | null;
  delivered_pdf_source_photo_ids: string[];
  delivered_pdf_source_document_ids: string[];
  current_delivery_id: string | null;
  assignment_date: string | null;
  deadline_date: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  invoice_number: string | null;
  invoice_path: string | null;
  invoiced_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  archive_reason_code: ArchiveReasonCode | null;
  archive_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobWithAssignee extends Job {
  assignment: JobAssignment | null;
}

export interface Crew {
  id: string;
  name: string;
  lead_technician_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CrewMember {
  crew_id: string;
  technician_id: string;
}

export interface JobAssignment {
  id: string;
  job_id: string;
  assignee_type: AssigneeType;
  technician_id: string | null;
  crew_id: string | null;
  assigned_by: string;
  assigned_at: string;
  is_primary: boolean;
  active: boolean;
}

export interface JobStatusHistoryEntry {
  id: string;
  job_id: string;
  previous_status: JobStatus | null;
  new_status: JobStatus | null;
  previous_incident: IncidentType | null;
  new_incident: IncidentType | null;
  changed_by: string;
  notes: string | null;
  created_at: string;
}

export interface JobProductionCode {
  id: string;
  job_id: string;
  code: string;
  quantity: number;
  notes: string | null;
  added_by: string;
  catalog_id: string | null;
  credited_technician_id: string | null;
  technician_type_snapshot: "in_house" | "contractor" | null;
  unit_snapshot: ProductionUnit | null;
  unit_rate_snapshot: number | null;
  amount_snapshot: number | null;
  price_category_id?: string | null;
  price_category_name_snapshot?: string | null;
  description_snapshot?: string | null;
  production_date: string | null;
  created_at: string;
}

export interface JobArchiveEvent {
  id: string;
  event_type: "archived" | "restored";
  reason_code: ArchiveReasonCode | null;
  notes: string | null;
  actor_id: string | null;
  actor_name: string | null;
  occurred_at: string;
  is_legacy: boolean;
}

export type ProductionUnit = "fixed" | "foot" | "hour" | "event";

export interface ProductionCatalogOption {
  id: string;
  code: string;
  description: string;
  unit: ProductionUnit;
  unit_rate: number | null;
  price_category_id: string | null;
  price_category_name: string | null;
}

export interface WeeklyProductionLine {
  week_start: string;
  week_end: string;
  production_date: string;
  code: string;
  description: string | null;
  unit: ProductionUnit;
  quantity: number;
  amount: number;
  billing_state: "pending" | "confirmed";
}

export interface ProductionReportLine {
  production_date: string;
  technician_id: string;
  technician_name: string;
  code: string;
  description: string | null;
  unit: ProductionUnit;
  quantity: number;
  unit_rate: number;
  amount: number;
  billing_state: "pending" | "confirmed";
}

export interface WeeklyFinancialAllocation {
  week_start: string;
  week_end: string;
  allocation_date: string;
  job_id: string;
  delivery_id: string;
  prism_number: string | null;
  percentage_basis_points: number;
  allocated_cents: number;
  billing_state: "pending" | "confirmed";
}

export interface MyFinancialAllocation {
  allocation_version_id: string;
  delivery_id: string;
  job_id: string;
  version: number;
  percentage_basis_points: number;
  allocated_cents: number;
  source_amount_cents: number;
  participant_name: string;
  worker_specialty: string;
  created_at: string;
  is_current: boolean;
  state: "voided" | "superseded" | "current";
}

export interface JobFinancialAllocation {
  allocation_version_id: string;
  delivery_id: string;
  job_id: string;
  version: number;
  participant_id: string;
  percentage_basis_points: number;
  allocated_cents: number;
  source_amount_cents: number;
  participant_name: string;
  worker_specialty: string;
  created_at: string;
  is_current: boolean;
  state: "voided" | "superseded" | "current";
}

export interface TechnicianJobSummary {
  id: string;
  prism_number: string | null;
  title: string;
  address: string | null;
  main_status: string;
  deadline_date: string | null;
  updated_at: string;
  archived_at: string | null;
}

export interface FinancialAllocationReportLine {
  allocation_date: string;
  job_id: string;
  delivery_id: string;
  prism_number: string | null;
  participant_id: string;
  participant_name: string;
  worker_specialty: string;
  percentage_basis_points: number;
  allocated_cents: number;
  source_amount_cents: number;
  billing_state: "pending" | "confirmed";
}

export interface JobPhoto {
  id: string;
  job_id: string;
  storage_path: string;
  photo_type: "before" | "after" | "evidence";
  uploaded_by: string;
  comment: string | null;
  created_at: string;
  uploader_name?: string | null;
}

export type WorkerProductionBreakdown = {
  code: string;
  unit: ProductionUnit | null;
  quantity: number;
};

export type WorkerOperationsRow = {
  technician_id: string;
  technician_name: string;
  crew_names: string[];
  is_shift_active: boolean;
  shift_started_at: string | null;
  shift_active_until: string | null;
  weekly_production: number;
  weekly_delivered_jobs: number;
  weekly_fuel_amount: number;
  fuel_daily: { date: string; amount: number; no_fuel: boolean }[];
  weekly_allocated_cents?: number;
  production_breakdown: WorkerProductionBreakdown[];
  server_now: string;
  week_start_at: string;
  week_end_exclusive_at: string;
};

export interface JobDocument {
  id: string;
  job_id: string;
  display_name: string;
  storage_path: string;
  mime_type: "application/pdf";
  size_bytes: number;
  status: "pending" | "active";
  uploaded_by: string | null;
  created_at: string;
  confirmed_at: string;
  document_type: "original" | "additional";
  original_filename: string;
  file_hash: string | null;
  position: number;
  page_count: number | null;
  verification_status: "pending" | "metadata_verified" | "pdf_verified" | "failed";
  verified_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface JobPdfDraft {
  job_id: string;
  version: number;
  source_page_count: number;
  source_document_ids: string[];
  placements: import("./pdf-code-editor-core").PdfCodePlacement[];
  text_notes: import("./pdf-text-note-core").PdfTextNote[];
  allocations: { participantId: string; percentage: string }[];
  updated_at: string;
}

export type DeliveredPdfStatus = "pending" | "current" | "stale";

export interface OfficeJobPreview extends Job {
  assignee_label: string;
  photo_count: number;
  delivered_pdf_status: DeliveredPdfStatus;
}

export interface TechnicianDirectoryOption {
  id: string;
  label: string;
}

export type AssigneeOption =
  | ({ type: "technician" } & TechnicianDirectoryOption)
  | ({
      type: "crew";
      leadLabel: string;
      members: TechnicianDirectoryOption[];
    } & TechnicianDirectoryOption);

export interface CrewOfficeDto extends Crew {
  lead_label: string;
  members: TechnicianDirectoryOption[];
}
