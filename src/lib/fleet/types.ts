export const FLEET_VEHICLE_STATUSES = [
  "draft",
  "active",
  "maintenance",
  "out_of_service",
  "retired",
] as const;

export const FLEET_ASSIGNMENT_ROLES = ["primary", "backup"] as const;
export const FLEET_POLICY_STATUSES = ["pending", "active", "expired", "cancelled"] as const;
export const FLEET_MAINTENANCE_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export const FLEET_ODOMETER_SOURCES = ["weekly", "maintenance", "shift", "manual"] as const;
export const FLEET_EXPENSE_TYPES = [
  "registration",
  "toll",
  "parking",
  "wash",
  "repair",
  "other",
] as const;
export const FLEET_INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const FLEET_INCIDENT_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export const FLEET_DOCUMENT_TYPES = [
  "registration",
  "insurance",
  "inspection",
  "maintenance",
  "incident",
  "receipt",
  "title",
  "other",
] as const;

export type FleetVehicleStatus = (typeof FLEET_VEHICLE_STATUSES)[number];
export type FleetAssignmentRole = (typeof FLEET_ASSIGNMENT_ROLES)[number];
export type FleetPolicyStatus = (typeof FLEET_POLICY_STATUSES)[number];
export type FleetMaintenanceStatus = (typeof FLEET_MAINTENANCE_STATUSES)[number];
export type FleetOdometerSource = (typeof FLEET_ODOMETER_SOURCES)[number];
export type FleetExpenseType = (typeof FLEET_EXPENSE_TYPES)[number];
export type FleetIncidentSeverity = (typeof FLEET_INCIDENT_SEVERITIES)[number];
export type FleetIncidentStatus = (typeof FLEET_INCIDENT_STATUSES)[number];
export type FleetDocumentType = (typeof FLEET_DOCUMENT_TYPES)[number];
export type FleetMoneyCents = number;

type FleetAuditFields = {
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type FleetVehicle = FleetAuditFields & {
  id: string;
  unit_number: string;
  vin: string | null;
  license_plate: string | null;
  license_state: string | null;
  make: string;
  model: string;
  model_year: number | null;
  color: string | null;
  status: FleetVehicleStatus;
  acquired_on: string | null;
  retired_on: string | null;
  current_odometer_miles: number;
  notes: string | null;
};

export type FleetVehicleAssignment = FleetAuditFields & {
  id: string;
  vehicle_id: string;
  technician_id: string;
  assignment_role: FleetAssignmentRole;
  starts_on: string;
  ends_on: string | null;
  notes: string | null;
};

export type FleetInsurancePolicy = FleetAuditFields & {
  id: string;
  vehicle_id: string;
  provider: string;
  policy_number: string;
  coverage_type: string | null;
  status: FleetPolicyStatus;
  effective_on: string;
  expires_on: string;
  payment_due_on: string | null;
  premium_cents: FleetMoneyCents | null;
  deductible_cents: FleetMoneyCents | null;
  agent_name: string | null;
  agent_phone: string | null;
  notes: string | null;
};

export type FleetInsurancePayment = FleetAuditFields & {
  id: string;
  policy_id: string;
  paid_on: string;
  amount_cents: number;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
};

export type FleetMaintenanceRecord = FleetAuditFields & {
  id: string;
  vehicle_id: string;
  service_type: string;
  status: FleetMaintenanceStatus;
  scheduled_for: string | null;
  completed_on: string | null;
  odometer_miles: number | null;
  vendor: string | null;
  cost_cents: FleetMoneyCents;
  next_due_on: string | null;
  next_due_odometer_miles: number | null;
  description: string | null;
  notes: string | null;
};

export type FleetOdometerReading = FleetAuditFields & {
  id: string;
  vehicle_id: string;
  reading_miles: number;
  recorded_on: string;
  source: FleetOdometerSource;
  shift_id: string | null;
  notes: string | null;
  submitted_by: string;
};

export type FleetExpense = FleetAuditFields & {
  id: string;
  vehicle_id: string;
  expense_type: FleetExpenseType;
  occurred_on: string;
  amount_cents: number;
  vendor: string | null;
  description: string;
  notes: string | null;
};

export type FleetIncident = FleetAuditFields & {
  id: string;
  vehicle_id: string;
  reported_by: string;
  occurred_at: string;
  severity: FleetIncidentSeverity;
  status: FleetIncidentStatus;
  title: string;
  description: string;
  location: string | null;
  odometer_miles: number | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
};

export type FleetDocument = FleetAuditFields & {
  id: string;
  vehicle_id: string;
  document_type: FleetDocumentType;
  title: string;
  bucket_id: "fleet-documents";
  storage_path: string;
  mime_type: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  size_bytes: number;
  expires_on: string | null;
  notes: string | null;
  uploaded_by: string;
};

export type FleetSettings = FleetAuditFields & {
  id: 1;
  weekly_odometer_day: number;
  weekly_odometer_required: boolean;
  alert_day_offsets: number[];
  timezone: string;
};

export type FleetCostLedgerEntry = {
  source_type: "insurance" | "maintenance" | "expense" | "fuel";
  source_id: string;
  vehicle_id: string;
  occurred_on: string;
  amount_cents: number;
  description: string;
};

export type FleetActionResult<T = null> =
  | { success: true; message: string; data: T }
  | { success: false; message: string; code?: "invalid_input" | "forbidden" | "unavailable" };
