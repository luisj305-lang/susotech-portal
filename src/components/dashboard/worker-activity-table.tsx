"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TechnicianJobSummary, WorkerOperationsRow } from "@/lib/jobs/types";
import { listTechnicianJobs } from "@/lib/jobs/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { IconSearch, IconUsers, IconX } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import {
  formatMoney,
  formatQuantity,
  formatWeekRange,
} from "@/lib/dashboard/format";

const timeZone = "America/New_York";

const shiftStartFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const shiftUntilFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone,
  hour: "numeric",
  minute: "2-digit",
});

const fullDateTimeFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone,
  dateStyle: "medium",
  timeStyle: "short",
});

const unitLabels: Record<string, string> = {
  fixed: "fijo",
  foot: "pie",
  hour: "hora",
  event: "evento",
};

function formatShiftStart(iso: string | null): string {
  return iso ? shiftStartFormatter.format(new Date(iso)) : "—";
}

function formatShiftUntil(iso: string | null): string {
  return iso ? shiftUntilFormatter.format(new Date(iso)) : "—";
}

const inputClass =
  "min-h-11 rounded-xl border border-line bg-white px-3 py-2 text-sm focus:border-accent-500";

export function WorkerActivityTable({ rows }: { rows: WorkerOperationsRow[] }) {
  const [query, setQuery] = useState("");
  const [crew, setCrew] = useState("");
  const [status, setStatus] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [jobsModal, setJobsModal] = useState<{ technicianId: string; technicianName: string } | null>(null);
  const [jobs, setJobs] = useState<TechnicianJobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState("");

  const showJobs = (technicianId: string, technicianName: string) => {
    setJobsModal({ technicianId, technicianName });
    setJobs([]);
    setJobsError("");
    setJobsLoading(true);
    void listTechnicianJobs(technicianId).then((result) => {
      setJobsLoading(false);
      if (result.success) setJobs(result.data);
      else setJobsError(result.message);
    });
  };

  const crewOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      for (const name of row.crew_names) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es");
    const list = rows
      .filter(
        (row) => !q || row.technician_name.toLocaleLowerCase("es").includes(q),
      )
      .filter((row) => !crew || row.crew_names.includes(crew))
      .filter(
        (row) =>
          status === "" ||
          (status === "active" ? row.is_shift_active : !row.is_shift_active),
      );

    const byName = (a: WorkerOperationsRow, b: WorkerOperationsRow) =>
      a.technician_name.localeCompare(b.technician_name, "es");
    return [
      ...list.filter((row) => row.is_shift_active).sort(byName),
      ...list.filter((row) => !row.is_shift_active).sort(byName),
    ];
  }, [rows, query, crew, status]);

  const totals = useMemo(
    () => ({
      production: rows.reduce((sum, row) => sum + Number(row.weekly_production), 0),
      jobs: rows.reduce(
        (sum, row) => sum + Number(row.weekly_delivered_jobs),
        0,
      ),
      fuel: rows.reduce((sum, row) => sum + Number(row.weekly_fuel_amount), 0),
    }),
    [rows],
  );

  const weekRange = rows[0]
    ? formatWeekRange(rows[0].week_start_at, rows[0].week_end_exclusive_at)
    : null;

  const resetFilters = () => {
    setQuery("");
    setCrew("");
    setStatus("");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Actividad de trabajadores</CardTitle>
            <CardDescription>
              Estado, producción y gasolina de la semana actual.
            </CardDescription>
          </div>
          {weekRange ? (
            <p className="text-sm font-medium text-brand-900">
              {`Semana: ${weekRange}`}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre"
              aria-label="Buscar por nombre"
              className={cn(inputClass, "pl-9")}
            />
          </div>
          <select
            value={crew}
            onChange={(event) => setCrew(event.target.value)}
            aria-label="Filtrar por equipo"
            className={inputClass}
          >
            <option value="">Todos los equipos</option>
            {crewOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filtrar por estado"
            className={inputClass}
          >
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
          <button
            type="button"
            onClick={resetFilters}
            className={buttonClasses({ variant: "secondary", size: "md" })}
          >
            Limpiar filtros
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={IconUsers}
            title="No hay trabajadores disponibles"
            description="Los técnicos activos aparecerán aquí cuando sean creados y asignados."
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <p className="text-sm text-ink-muted">
              No hay resultados para los filtros seleccionados.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className={buttonClasses({ variant: "secondary", size: "md" })}
            >
              Limpiar filtros
            </button>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-4 py-3 text-left font-medium">
                        Trabajador
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Crew(s)</th>
                      <th className="px-4 py-3 text-left font-medium">Estado</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Inicio de jornada
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Activo hasta
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Producción semanal
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Trabajos entregados
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Gasolina semanal
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const expanded = expandedId === row.technician_id;
                      return (
                        <RowGroup
                          key={row.technician_id}
                          row={row}
                          expanded={expanded}
                          onToggle={() =>
                            setExpandedId(expanded ? null : row.technician_id)
                          }
                          onShowJobs={showJobs}
                        />
                      );
                    })}
                    <tr className="border-t-2 border-brand-200 bg-brand-50 font-bold text-brand-900">
                      <td className="px-4 py-3" colSpan={5}>
                        TOTAL
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatQuantity(totals.production)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatQuantity(totals.jobs)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(totals.fuel)}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="divide-y divide-line md:hidden">
              {filtered.map((row) => {
                const expanded = expandedId === row.technician_id;
                return (
                  <div key={row.technician_id} className="rounded-2xl border border-line p-4 shadow-soft">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => showJobs(row.technician_id, row.technician_name)}
                        className="truncate border-0 bg-transparent p-0 text-left font-semibold text-accent-600 hover:text-accent-500 hover:underline"
                      >
                        {row.technician_name}
                      </button>
                      <StatusBadge status={row.is_shift_active ? "activo" : "inactivo"} />
                    </div>
                    {row.crew_names.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {row.crew_names.map((name) => (
                          <span
                            key={name}
                            className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs text-ink-soft"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-ink-muted">Inicio</dt>
                        <dd className="text-ink-soft">
                          {formatShiftStart(row.shift_started_at)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Activo hasta</dt>
                        <dd className="text-ink-soft">
                          {formatShiftUntil(row.shift_active_until)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Producción</dt>
                        <dd className="font-medium text-ink">
                          {formatQuantity(row.weekly_production)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Entregados</dt>
                        <dd className="font-medium text-ink">
                          {row.weekly_delivered_jobs}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Gasolina</dt>
                        <dd className="font-medium text-ink">
                          {formatMoney(row.weekly_fuel_amount)}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(expanded ? null : row.technician_id)
                      }
                      className="mt-3 border-0 bg-transparent p-0 text-sm font-medium text-accent-600 hover:text-accent-500"
                    >
                      {expanded ? "Ocultar detalles" : "Detalles"}
                    </button>
                    {expanded ? (
                      <BreakdownPanel row={row} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
      {jobsModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-brand-950/40 p-4" onClick={() => setJobsModal(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 text-ink shadow-card" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Trabajos de {jobsModal.technicianName}</h2>
              <button type="button" aria-label="Cerrar" onClick={() => setJobsModal(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink hover:bg-surface-muted"><IconX /></button>
            </div>
            {jobsLoading ? (
              <p className="py-8 text-center text-sm text-ink-muted">Cargando…</p>
            ) : jobsError ? (
              <p className="py-8 text-center text-sm text-ink">{jobsError}</p>
            ) : jobs.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-muted">No tiene trabajos asignados.</p>
            ) : (
              <ul className="grid max-h-[60vh] gap-2 overflow-y-auto">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link href={`/trabajos/${job.id}`} onClick={() => setJobsModal(null)} className="block rounded-lg border border-line bg-surface-muted p-3 hover:bg-surface-muted/60">
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-ink">{job.prism_number || job.title}</span>
                        <StatusBadge status={job.main_status} />
                      </span>
                      <span className="mt-1 block text-sm text-ink-soft">{job.title}{job.address ? ` · ${job.address}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function RowGroup({
  row,
  expanded,
  onToggle,
  onShowJobs,
}: {
  row: WorkerOperationsRow;
  expanded: boolean;
  onToggle: () => void;
  onShowJobs: (technicianId: string, technicianName: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-line hover:bg-surface-muted/60">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => onShowJobs(row.technician_id, row.technician_name)}
            className="max-w-[180px] truncate border-0 bg-transparent p-0 text-left font-semibold text-accent-600 hover:text-accent-500 hover:underline"
            title={`Ver trabajos de ${row.technician_name}`}
          >
            {row.technician_name}
          </button>
        </td>
        <td className="px-4 py-3">
          {row.crew_names.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.crew_names.map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs text-ink-soft"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={row.is_shift_active ? "activo" : "inactivo"} />
        </td>
        <td className="px-4 py-3 text-ink-soft">
          {formatShiftStart(row.shift_started_at)}
        </td>
        <td className="px-4 py-3 text-ink-soft">
          {formatShiftUntil(row.shift_active_until)}
        </td>
        <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
          {formatQuantity(row.weekly_production)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-ink">
          {row.weekly_delivered_jobs}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-ink">
          {formatMoney(row.weekly_fuel_amount)}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="border-0 bg-transparent p-0 text-sm font-medium text-accent-600 hover:text-accent-500"
          >
            {expanded ? "Ocultar" : "Detalles"}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-line bg-surface-muted/40">
          <td colSpan={9} className="px-4 py-3">
            <BreakdownPanel row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BreakdownPanel({ row }: { row: WorkerOperationsRow }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <p className="text-xs text-ink-muted">
          Inicio de jornada:{" "}
          <span className="font-medium text-ink-soft">
            {row.shift_started_at
              ? fullDateTimeFormatter.format(new Date(row.shift_started_at))
              : "—"}
          </span>
        </p>
        <p className="text-xs text-ink-muted">
          Activo hasta:{" "}
          <span className="font-medium text-ink-soft">
            {row.shift_active_until
              ? fullDateTimeFormatter.format(new Date(row.shift_active_until))
              : "—"}
          </span>
        </p>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Desglose de producción
        </p>
        {row.production_breakdown.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {row.production_breakdown.map((item) => (
              <li
                key={`${item.code}:${item.unit ?? ""}`}
                className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-ink-soft"
              >
                {item.code}: {formatQuantity(item.quantity)}
                {item.unit ? ` ${unitLabels[item.unit] ?? item.unit}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-muted">Sin producción registrada.</p>
        )}
      </div>
    </div>
  );
}
