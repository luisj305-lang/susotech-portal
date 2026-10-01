import Link from "next/link";
import { JobList } from "@/components/jobs/job-list";
import { ArchivedJobDeleteButton, RetryJobDeletionCleanupButton } from "@/components/jobs/archived-job-delete-button";
import { AppShell } from "@/components/dashboard/app-shell";
import { FieldShell } from "@/components/dashboard/field-shell";
import { buttonClasses } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { displayName, initials, roleLabel } from "@/lib/dashboard/profile";
import { requireOfficeViewer, requireProfile } from "@/lib/auth/session";
import { listOfficeJobs, listTechnicianQueueJobs } from "@/lib/jobs/queries";
import { groupJobParts } from "@/lib/jobs/parts";
import { getJobMapUrl } from "@/lib/jobs/maps";
import { requireActiveShiftPage } from "@/lib/work-shifts/access";
import { workTypeLabels } from "@/lib/jobs/work-types";
import type { OfficeJobPreview } from "@/lib/jobs/types";
import { getMyManualJobs, getOfficeManualJobs } from "@/lib/manual-jobs/queries";
import { combineWorkItems, filterManualWork, isInWorkWeek, manualFilterLabels } from "@/lib/jobs/work-list";
import { referenceAtForNewYorkWeek } from "@/lib/time/new-york-week";
import { ManualWorkCard } from "@/components/jobs/manual-work-card";

const statusLabels: Record<string, string> = { sin_asignar: "Sin asignar", asignado: "Asignado", en_revision: "En revisión", aprobado: "Aprobado", facturado: "Facturado", pagado: "Pagado" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function relevantDate(job: { submitted_at: string | null; deadline_date: string | null; assignment_date: string | null; updated_at: string }) {
  const value = job.submitted_at || job.deadline_date || job.assignment_date || job.updated_at;
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium" }).format(new Date(value));
}

function OfficeJobCard({ job, showDelete }: { job: OfficeJobPreview; showDelete: boolean }) {
  const mapUrl = getJobMapUrl({ address: job.address, location: job.location, projectMapUrl: job.project_map_url });
  return (
    <article className="rounded-[var(--radius-surface)] border border-line bg-white p-5 shadow-[var(--shadow-card-compact)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-muted">{job.prism_number ? `PRISM ${job.prism_number}` : "Sin número PRISM"}</p>
          {mapUrl ? <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xl font-bold text-ink underline">{job.address || job.location || "Sin dirección"}</a> : <h2 className="mt-1 text-xl font-bold text-ink">{job.address || job.location || "Sin dirección"}</h2>}
          <p className="mt-1 text-sm text-ink-soft">{workTypeLabels(job).join(", ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {job.partLabel && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-soft">{job.partLabel}</span>}
          <StatusBadge status={job.main_status} />
        </div>
      </div>
      <dl className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-ink-muted">Asignado</dt><dd className="font-semibold">{job.assignee_label}</dd></div>
        <div><dt className="text-ink-muted">Fecha relevante</dt><dd className="font-semibold">{relevantDate(job)}</dd></div>
        <div><dt className="text-ink-muted">Evidencias</dt><dd className="font-semibold">{job.photo_count} foto(s)</dd></div>
        <div><dt className="text-ink-muted">PDF original</dt><dd className="font-semibold">{job.project_pdf_url ? "Disponible" : "No disponible"}</dd></div>
        <div><dt className="text-ink-muted">PDF entregado</dt><dd><StatusBadge status={`pdf_${job.delivered_pdf_status}`} /></dd></div>
      </dl>
      {job.incident && <p className="mt-4 rounded-lg border border-line bg-surface-muted p-3 text-sm font-semibold text-ink">Incidencia: {job.incident}</p>}
      <Link href={`/trabajos/${job.id}`} className={`${buttonClasses({ variant: "primary" })} mt-5`}>Ver trabajo</Link>
      {showDelete && <ArchivedJobDeleteButton jobId={job.id} label={job.prism_number ? `el trabajo PRISM ${job.prism_number}` : `el trabajo ${job.title}`} />}
    </article>
  );
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile();
  const values = await searchParams;
  const first = (key: string) => { const value = values[key]; return Array.isArray(value) ? value[0] : value; };
  const rawWeek = first("week");
  const weekOffset = rawWeek !== undefined && Number.isInteger(Number(rawWeek)) ? Number(rawWeek) : undefined;
  const referenceAt = weekOffset === undefined ? undefined : new Date(referenceAtForNewYorkWeek(weekOffset));
  const weekSuffix = weekOffset === undefined ? "" : `&week=${weekOffset}`;
  if (profile.role === "tecnico") {
    await requireActiveShiftPage();
    const query = first("q");
    const status = first("status");
    const rawTab = first("tab");
    const tab = rawTab === "revisados" || rawTab === "todos" ? rawTab : "activos";
    const [regularJobs, manuals] = await Promise.all([
      status?.startsWith("manual:") ? Promise.resolve([]) : listTechnicianQueueJobs({ query, status, tab }),
      getMyManualJobs(),
    ]);
    const jobs = regularJobs.filter((job) => !referenceAt || isInWorkWeek(job.assignedAt, referenceAt));
    const manualJobs = filterManualWork(manuals, { query, status, tab, referenceAt });
    return <FieldShell userName={displayName(profile)}><JobList jobs={jobs} manualJobs={manualJobs} initialQuery={query ?? ""} initialStatus={status ?? ""} tab={tab} weekOffset={weekOffset} /></FieldShell>;
  }
  const officeProfile = await requireOfficeViewer();
  const prism = first("prism");
  const hasHistoricalPrismLookup = Boolean(prism?.trim());
  const filters = { q: first("q"), prism, status: first("status"), archived: first("archived") === "1", facturados: first("facturados") === "1" };
  const [regularJobs, manuals] = await Promise.all([
    !hasHistoricalPrismLookup && filters.status?.startsWith("manual:") ? Promise.resolve([]) : listOfficeJobs({ query: filters.q, prism: filters.prism, status: filters.status, archived: filters.archived, facturados: filters.facturados }),
    hasHistoricalPrismLookup ? Promise.resolve([]) : getOfficeManualJobs(),
  ]);
  const jobs = regularJobs.filter((job) => hasHistoricalPrismLookup || !referenceAt || isInWorkWeek(job.assignedAt, referenceAt));
  const manualJobs = hasHistoricalPrismLookup ? [] : filterManualWork(manuals, { ...filters, query: filters.q, referenceAt });
  const entries = combineWorkItems(groupJobParts(jobs).map((group) => ({ ...group, id: group.root.id })), manualJobs);
  const showDelete = !hasHistoricalPrismLookup && filters.archived && (officeProfile.role === "admin" || officeProfile.role === "supervisor");

  return (
    <AppShell role={officeProfile.role as "admin" | "supervisor"} userName={displayName(officeProfile)} roleLabel={roleLabel(officeProfile.role)} initials={initials(officeProfile)}>
      <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <Link href={weekOffset === undefined ? "/dashboard" : `/dashboard?week=${weekOffset}`} className="text-sm font-medium text-accent-600 hover:text-accent-500">← Dashboard</Link>
        <header className="flex flex-wrap items-end justify-between gap-4 rounded-[var(--radius-surface)] bg-white p-5 shadow-[var(--shadow-card-compact)] sm:p-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-ink-muted">Operaciones</p>
            <h1 className="text-3xl font-bold text-ink">{hasHistoricalPrismLookup ? "Resultados PRISM" : filters.archived ? "Trabajos archivados" : filters.facturados ? "Trabajos facturados" : "Trabajos"}</h1>
            <p className="mt-1 text-ink-soft">Identifique cada orden, su asignación, documentos y evidencias sin abrirla.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {filters.archived && !hasHistoricalPrismLookup && officeProfile.role === "admin" && <RetryJobDeletionCleanupButton />}
            {!filters.archived && !filters.facturados && <Link href={`/trabajos?facturados=1${weekSuffix}`} className={buttonClasses({ variant: "secondary" })}>Ver facturados</Link>}
            {filters.archived || filters.facturados ? <Link href={weekOffset === undefined ? "/trabajos" : `/trabajos?week=${weekOffset}`} className={buttonClasses({ variant: "secondary" })}>Ver activos</Link> : <Link href={`/trabajos?archived=1${weekSuffix}`} className={buttonClasses({ variant: "secondary" })}>Ver archivados</Link>}
            <Link href="/trabajos/importar" className={buttonClasses({ variant: "primary" })}>Importar PDF</Link>
            <Link href="/trabajos/nuevo" className={buttonClasses({ variant: "secondary" })}>Creación manual</Link>
          </div>
        </header>
        <div className="grid gap-4 rounded-[var(--radius-surface)] border border-line bg-white p-4 shadow-[var(--shadow-card-compact)]">
          <form className="flex flex-wrap items-end gap-2">
            {weekOffset !== undefined && <input type="hidden" name="week" value={weekOffset} />}
            {filters.archived && <input type="hidden" name="archived" value="1" />}
            {filters.facturados && <input type="hidden" name="facturados" value="1" />}
            {filters.status && <input type="hidden" name="status" value={filters.status} />}
            <label className="grid flex-1 gap-1 text-sm font-medium text-ink-soft">Buscar por PRISM, título o dirección<input name="q" defaultValue={filters.q} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border border-line bg-white px-3 py-2 text-sm text-ink focus:border-accent-500 focus:outline-none" /></label>
            <button className={buttonClasses({ variant: "secondary" })}>Buscar</button>
          </form>
          <form>
            {weekOffset !== undefined && <input type="hidden" name="week" value={weekOffset} />}
            {filters.archived && <input type="hidden" name="archived" value="1" />}
            {filters.facturados && <input type="hidden" name="facturados" value="1" />}
            {filters.q && <input type="hidden" name="q" value={filters.q} />}
            <span className="text-sm font-medium text-ink-soft">Estado</span>
            <div className="mt-1 flex flex-wrap gap-2">
              <FilterChip name="status" value="" label="Todos" active={!filters.status} />
              {Object.entries({ ...statusLabels, ...manualFilterLabels }).map(([value, label]) => <FilterChip key={value} name="status" value={value} label={label} active={filters.status === value} />)}
            </div>
          </form>
        </div>
        {entries.length ? <div className="grid gap-4 lg:grid-cols-2">{entries.map((entry) => entry.source === "manual" ? <ManualWorkCard key={entry.key} job={entry.job} /> : (
          <div key={entry.key} data-work-source="regular" className="grid content-start gap-4">
            <OfficeJobCard job={entry.job.root} showDelete={showDelete} />
            {entry.job.children.length > 0 && (
              <div className="grid gap-4 border-l-2 border-line pl-4">
                {entry.job.children.map((child) => <OfficeJobCard key={`regular:${child.id}`} job={child} showDelete={showDelete} />)}
              </div>
            )}
          </div>
        ))}</div> : <section className="rounded-2xl border border-dashed border-line p-10 text-center"><h2 className="font-semibold text-ink">No hay trabajos que coincidan</h2><p className="mt-2 text-sm text-ink-muted">Cambie los filtros o importe un PDF.</p></section>}
      </div>
    </AppShell>
  );
}
