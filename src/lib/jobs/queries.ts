import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listActiveTechniciansCore } from "./crew-core";
import { getDeliveredPdfStatus } from "./delivered-status";
import type { AssigneeOption, CrewOfficeDto, Job, JobAssignment, JobCategory, JobPhoto, JobProductionCode, JobStatus, JobStatusHistoryEntry, OfficeJobPreview } from "./types";

const statuses: JobStatus[] = ["asignado", "en_progreso", "enviado_revision", "aprobado", "listo_pagar", "pagado"];
const categories: JobCategory[] = ["categoria_1", "categoria_2", "categoria_3"];

export async function listAssigneeOptions(): Promise<AssigneeOption[]> {
  const { technicians, crews } = await listCrewManagementData();
  return [
    ...technicians.map((profile) => ({ type: "technician" as const, ...profile })),
    ...crews.filter((crew) => crew.is_active).map((crew) => ({
      type: "crew" as const,
      id: crew.id,
      label: crew.name,
      leadLabel: crew.lead_label,
      members: crew.members,
    })),
  ];
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

export async function listOfficeJobs(filters: { query?: string; status?: string; category?: string }) {
  const supabase = await createClient();
  let request = supabase.from("jobs").select("*").order("updated_at", { ascending: false });
  if (statuses.includes(filters.status as JobStatus)) request = request.eq("main_status", filters.status);
  if (categories.includes(filters.category as JobCategory)) request = request.eq("category", filters.category);
  const [jobsResult, assignmentsResult, photosResult, options] = await Promise.all([
    request,
    supabase.from("job_assignments").select("job_id, assignee_type, technician_id, crew_id").eq("active", true).eq("is_primary", true),
    supabase.from("job_photos").select("id, job_id"),
    listAssigneeOptions(),
  ]);
  if (jobsResult.error || assignmentsResult.error || photosResult.error) throw new Error("No se pudieron cargar los trabajos.");
  const labels = new Map(options.map((option) => [`${option.type}:${option.id}`, option.label]));
  const assignments = new Map((assignmentsResult.data ?? []).map((item) => [item.job_id, item]));
  const photoIds = new Map<string, string[]>();
  for (const photo of photosResult.data ?? []) photoIds.set(photo.job_id, [...(photoIds.get(photo.job_id) ?? []), photo.id]);
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
        delivered_pdf_status: getDeliveredPdfStatus(job, currentIds),
      };
    });
}

export async function listTechnicianJobs() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").select("*").order("deadline_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error("No se pudieron cargar tus trabajos.");
  return (data ?? []) as Job[];
}

export async function getTechnicianJob(jobId: string) {
  const supabase = await createClient();
  const [job, history, codes, photos] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_status_history").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("job_production_codes").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("job_photos").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
  ]);
  if (job.error || history.error || codes.error || photos.error) throw new Error("No se pudo cargar el trabajo asignado.");
  if (!job.data) return null;
  return { job: job.data as Job, history: (history.data ?? []) as JobStatusHistoryEntry[], codes: (codes.data ?? []) as JobProductionCode[], photos: (photos.data ?? []) as JobPhoto[] };
}

export async function getOfficeJob(jobId: string) {
  const supabase = await createClient();
  const [jobResult, assignmentResult, historyResult, photosResult, crewData] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_assignments").select("*").eq("job_id", jobId).eq("active", true).eq("is_primary", true).maybeSingle(),
    supabase.from("job_status_history").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    supabase.from("job_photos").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    listCrewManagementData(),
  ]);
  if (jobResult.error) throw new Error("No se pudo cargar el trabajo.");
  for (const result of [assignmentResult, historyResult, photosResult]) {
    if (result.error) throw new Error("No se pudieron cargar los datos relacionados.");
  }
  if (!jobResult.data) return null;
  const options: AssigneeOption[] = [
    ...crewData.technicians.map((profile) => ({ type: "technician" as const, ...profile })),
    ...crewData.crews.filter((crew) => crew.is_active).map((crew) => ({
      type: "crew" as const,
      id: crew.id,
      label: crew.name,
      leadLabel: crew.lead_label,
      members: crew.members,
    })),
  ];
  return {
    job: jobResult.data as Job,
    assignment: assignmentResult.data as JobAssignment | null,
    history: (historyResult.data ?? []) as JobStatusHistoryEntry[],
    photos: (photosResult.data ?? []) as JobPhoto[],
    options,
  };
}
