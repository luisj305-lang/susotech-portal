import type { CrewOfficeDto, TechnicianDirectoryOption } from "@/lib/jobs/types";

type CrewMembership = Pick<CrewOfficeDto, "lead_technician_id" | "members">;

export function availableCrewMembers(crew: CrewMembership, technicians: TechnicianDirectoryOption[]) {
  const existing = new Set(crew.members.map((member) => member.id));
  return technicians.filter((technician) => !existing.has(technician.id));
}

export function canRemoveCrewMember(crew: CrewMembership, technicianId: string) {
  return crew.lead_technician_id !== technicianId;
}
