import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listActiveTechniciansCore } from "./crew-core";
import { getDeliveredPdfStatus } from "./delivered-status";
import { requireActiveShift } from "@/lib/work-shifts/access";
import type { AssigneeOption, CrewOfficeDto, Job, JobArchiveEvent, JobAssignment, JobCategory, JobDocument, JobPdfDraft, JobPhoto, JobProductionCode, JobStatus, JobStatusHistoryEntry, OfficeJobPreview, ProductionCatalogOption, ProductionReportLine, WeeklyProductionLine, WorkerOperationsRow } from "./types";

const statuses: JobStatus[] = ["asignado", "en_progreso", "enviado_revision", "aprobado", "listo_pagar", "pagado"];
const categories: JobCategory[] = ["categoria_1", "categoria_2", "categoria_3"];

export async function listAssigneeOptions(): Promise<AssigneeOption[]> {
  return (await listActiveTechniciansCore(await createClient()))
    .map((profile) => ({ type: "technician" as const, ...profile }));
}

export async function listCrewManagementData(): Promise<{ crews: CrewOfficeDto[]; technicians: Awaited<ReturnType<typeof listActiveTechniciansCore>> }> {
  const supabase = await createClient();
  const [directory, crews] = await Promise.all([
    listActiveTechniciansCore(supabase),
    supabase.from("crews").select("*, crew_members(technician_id)").order("name"),
  ]);
  if (crews.error) throw new Error("No se pudieron cargar los equipos.");
  const labels = new Map(directory.map((item) => [item.id, item.label]));
  const rows = (crews.data ?? []).map((crew) => ({
    id: crew.id, name: crew.name, lead_technician_id: crew.lead_technician_id,
    is_active: crew.is_active, created_at: crew.created_at, updated_at: crew.updated_at,
    lead_label: labels.get(crew.lead_technician_id) ?? "Técnico no disponible",
    members: (crew.crew_members ?? []).map(({ technician_id }: { technician_id: string }) => ({ id: technician_id, label: labels.get(technician_id) ?? "Técnico no disponible" })),
  }));
  return { crews: rows, technicians: directory };
}

export async function listCrewsForOffice(): Promise<CrewOfficeDto[]> {
  return (await listCrewManagementData()).crews;
}

export async function listOfficeJobs(filters: { query?: string; status?: string; category?: string; archived?: boolean }) {
  const supabase = await createClient();
  let request = supabase.from("jobs").select("*").order("updated_at", { ascending: false });
  request = filters.archived ? request.not("archived_at", "is", null) : request.is("archived_at", null);
  if (statuses.includes(filters.status as JobStatus)) request = request.eq("main_status", filters.status);
  if (categories.includes(filters.category as JobCategory)) request = request.eq("category", filters.category);
  const [jobsResult, assignmentsResult, photosResult, documentsResult, draftsResult, deliveryVersionsResult, options, crewsResult] = await Promise.all([
    request,
    supabase.from("job_assignments").select("job_id, assignee_type, technician_id, crew_id").eq("active", true).eq("is_primary", true),
    supabase.from("job_photos").select("id, job_id").is("deleted_at", null),
    supabase.from("job_documents").select("id,job_id,position").eq("status", "active").is("deleted_at", null).order("position", { ascending: true }),
    supabase.from("job_pdf_drafts").select("job_id,version"),
    supabase.from("job_pdf_delivery_versions").select("job_id,draft_version"),
    listAssigneeOptions(),
    supabase.from("crews").select("id,name"),
  ]);
  if (jobsResult.error || assignmentsResult.error || photosResult.error || documentsResult.error || draftsResult.error || deliveryVersionsResult.error || crewsResult.error) throw new Error("No se pudieron cargar los trabajos.");
  const labels = new Map<string, string>([
    ...options.map((option) => [`technician:${option.id}`, option.label] as const),
    ...(crewsResult.data ?? []).map((crew) => [`crew:${crew.id}`, crew.name] as const),
  ]);
  const assignments = new Map((assignmentsResult.data ?? []).map((item) => [item.job_id, item]));
  const photoIds = new Map<string, string[]>();
  const documentIds = new Map<string, string[]>();
  const draftVersions = new Map((draftsResult.data ?? []).map((item) => [item.job_id, item.version]));
  const deliveryVersions = new Map((deliveryVersionsResult.data ?? []).map((item) => [item.job_id, item.draft_version]));
  for (const photo of photosResult.data ?? []) photoIds.set(photo.job_id, [...(photoIds.get(photo.job_id) ?? []), photo.id]);
  for (const document of documentsResult.data ?? []) documentIds.set(document.job_id, [...(documentIds.get(document.job_id) ?? []), document.id]);
  const query = filters.query?.trim().toLocaleLowerCase("es") ?? "";
  return ((jobsResult.data ?? []) as Job[])
    .filter((job) => !query || [job.prism_number, job.title, job.address, job.location].some((value) => value?.toLocaleLowerCase("es").includes(query)))
    .map((job): OfficeJobPreview => {
      const assignment = assignments.get(job.id);
      const key = assignment ? `${assignment.assignee_type}:${assignment.assignee_type === "crew" ? assignment.crew_id : assignment.technician_id}` : "";
      const currentIds = [...(photoIds.get(job.id) ?? [])].sort();
      return {
        ...job,
        assignee_label: (key && labels.get(key)) || "Sin asignar",
        photo_count: currentIds.length,
        delivered_pdf_status: getDeliveredPdfStatus(job, currentIds, documentIds.get(job.id) ?? [], draftVersions.get(job.id), deliveryVersions.get(job.id)),
      };
    });
}

export async function listTechnicianJobs() {
  await requireActiveShift();
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").select("*").is("archived_at", null).order("deadline_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error("No se pudieron cargar tus trabajos.");
  return (data ?? []) as Job[];
}

export async function getTechnicianJob(jobId: string) {
  await requireActiveShift();
  const supabase = await createClient();
  const [job, history, codes, photos, documents, draft, deliveryVersion, catalog] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_status_history").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("job_production_codes").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("job_photos").select("*").eq("job_id", jobId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("job_documents").select("*").eq("job_id", jobId).order("position", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("job_pdf_drafts").select("*").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_pdf_delivery_versions").select("draft_version").eq("job_id", jobId).maybeSingle(),
    supabase.rpc("list_my_production_catalog"),
  ]);
  if (job.error || history.error || codes.error || photos.error || documents.error || draft.error || deliveryVersion.error || catalog.error) throw new Error("No se pudo cargar el trabajo asignado.");
  if (!job.data) return null;
  return { job: job.data as Job, history: (history.data ?? []) as JobStatusHistoryEntry[], codes: (codes.data ?? []) as JobProductionCode[], photos: (photos.data ?? []) as JobPhoto[], documents: (documents.data ?? []) as JobDocument[], draft: draft.data as JobPdfDraft | null, deliveredDraftVersion: deliveryVersion.data?.draft_version as number | undefined, catalog: (catalog.data ?? []) as ProductionCatalogOption[] };
}

export async function getMyWeeklyProduction() {
  const { data, error } = await (await createClient()).rpc("get_my_weekly_production", { p_reference_date: null });
  if (error) throw new Error("No se pudo cargar la producción semanal.");
  return (data ?? []) as WeeklyProductionLine[];
}

export async function getMyWeeklyFinancialAllocations() {
  const { data, error } = await (await createClient()).rpc("get_my_weekly_financial_allocations", { p_reference_date: null });
  if (error) throw new Error("No se pudo cargar tu distribución financiera semanal.");
  return (data ?? []) as import("./types").WeeklyFinancialAllocation[];
}

export async function getWorkerOperationsDashboard(referenceAt?: string | null) {
  const supabase = await createClient();
  const [operations, financial] = await Promise.all([
    supabase.rpc("get_worker_operations_dashboard", { p_reference_at: referenceAt ?? null }),
    supabase.rpc("get_worker_weekly_financial_dashboard", { p_reference_at: referenceAt ?? null }),
  ]);
  if (operations.error || financial.error) throw new Error("No se pudo cargar la operación semanal de trabajadores.");
  const amounts = new Map<string, number>(
    ((financial.data ?? []) as Array<{ participant_id: string; allocated_cents: number }>).map((row) => [
      row.participant_id,
      Number(row.allocated_cents),
    ]),
  );
  return ((operations.data ?? []) as WorkerOperationsRow[]).map((row) => ({
    ...row, weekly_allocated_cents: amounts.get(row.technician_id) ?? 0,
  }));
}

export async function getProductionReport(startDate: string, endDate: string) {
  const { data, error } = await (await createClient()).rpc("get_production_report", { p_start_date: startDate, p_end_date: endDate });
  if (error) throw new Error("No se pudo cargar el reporte de producción.");
  return (data ?? []) as ProductionReportLine[];
}

export async function getFinancialAllocationReport(startDate: string, endDate: string) {
  const { data, error } = await (await createClient()).rpc("get_financial_allocation_report", {
    p_start_date: startDate, p_end_date: endDate,
  });
  if (error) throw new Error("No se pudo cargar la distribución financiera.");
  return (data ?? []) as import("./types").FinancialAllocationReportLine[];
}

export async function getOfficeJob(jobId: string) {
  const supabase = await createClient();
  const [jobResult, assignmentResult, historyResult, archiveResult, photosResult, codesResult, documentsResult, draftResult, deliveryVersionResult, crewData] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_assignments").select("*").eq("job_id", jobId).eq("active", true).eq("is_primary", true).maybeSingle(),
    supabase.from("job_status_history").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.rpc("list_job_archive_events_for_office", { p_job_id: jobId }),
    supabase.from("job_photos").select("*").eq("job_id", jobId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("job_production_codes").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("job_documents").select("*").eq("job_id", jobId).order("position", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("job_pdf_drafts").select("*").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_pdf_delivery_versions").select("draft_version").eq("job_id", jobId).maybeSingle(),
    listCrewManagementData(),
  ]);
  if (jobResult.error) throw new Error("No se pudo cargar el trabajo.");
  for (const result of [assignmentResult, historyResult, archiveResult, photosResult, codesResult, documentsResult, draftResult, deliveryVersionResult]) {
    if (result.error) throw new Error("No se pudieron cargar los datos relacionados.");
  }
  if (!jobResult.data) return null;
  const options: AssigneeOption[] = crewData.technicians
    .map((profile) => ({ type: "technician" as const, ...profile }));
  const technicianLabels = new Map(crewData.technicians.map((technician) => [technician.id, technician.label]));
  return {
    job: jobResult.data as Job,
    assignment: assignmentResult.data as JobAssignment | null,
    history: (historyResult.data ?? []) as JobStatusHistoryEntry[],
    archiveEvents: (archiveResult.data ?? []) as JobArchiveEvent[],
    photos: (photosResult.data ?? []).map((photo) => ({
      ...photo,
      uploader_name: technicianLabels.get(photo.uploaded_by) ?? "Usuario registrado",
    })) as JobPhoto[],
    codes: (codesResult.data ?? []) as JobProductionCode[],
    documents: (documentsResult.data ?? []) as JobDocument[],
    draft: draftResult.data as JobPdfDraft | null,
    deliveredDraftVersion: deliveryVersionResult.data?.draft_version as number | undefined,
    options,
  };
}
