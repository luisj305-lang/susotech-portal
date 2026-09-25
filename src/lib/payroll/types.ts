export type CompensationMode = "percentage" | "hourly";

export type OfficeHourlyShiftRow = {
  shiftId: string;
  workDate: string;
  startedAt: string;
  finishedAt: string | null;
  settledAt: string | null;
  settlementKind: "self" | "auto" | null;
  payableMinutes: number | null;
  payableCents: number | null;
  hourlyRateCents: number | null;
};

export type OfficeHourlyTechnician = {
  technicianId: string;
  name: string;
  hourlyRateCents: number;
  periodStatus: "pending" | "approved";
  periodTotalPayableCents: number;
  periodRecordExists: boolean;
  settledMinutes: number;
  shifts: OfficeHourlyShiftRow[];
};

export type OfficeHourlyPayroll = {
  periodStart: string;
  periodEndExclusive: string;
  isCurrentPeriod: boolean;
  technicians: OfficeHourlyTechnician[];
};
