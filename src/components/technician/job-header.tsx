import Link from "next/link";
import type { Job } from "@/lib/jobs/types";
import { StatusBadge } from "@/components/ui/status-badge";

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function JobHeader({
  job,
  mapUrl,
}: {
  job: Job;
  mapUrl: string | null;
}) {
  const heading = job.prism_number ? `PRISM-${job.prism_number}` : job.title;
  const subtitle = job.prism_number ? job.title : null;
  const relevantDate = job.submitted_at ?? job.deadline_date ?? job.assignment_date ?? job.updated_at;
  const tags: string[] = [
    job.category.replace("categoria_", "Categoría "),
    job.job_type,
    job.customer_name,
  ].filter((value): value is string => Boolean(value));

  return (
    <header>
      <Link
        href="/trabajos"
        className="text-sm font-medium text-accent-600 hover:text-accent-500"
      >
        ← Volver a mis trabajos
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={job.main_status} />
        {relevantDate ? (
          <span className="text-sm text-ink-muted">
            {dateFormatter.format(new Date(relevantDate))}
          </span>
        ) : null}
      </div>
      <h1 className="mt-3 text-2xl font-bold text-ink sm:text-3xl">{heading}</h1>
      {subtitle && subtitle !== heading ? (
        <p className="mt-1 text-ink-soft">{subtitle}</p>
      ) : null}
      {mapUrl ? (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-accent-600 underline"
        >
          {job.address || job.location}
        </a>
      ) : (
        <p className="mt-2 text-ink-muted">Ubicación no indicada</p>
      )}
      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs text-ink-soft"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </header>
  );
}
