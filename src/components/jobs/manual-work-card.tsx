import Link from "next/link";
import type { ManualJob } from "@/lib/manual-jobs/types";
import { manualJobHref, manualStatusLabels } from "@/lib/jobs/work-list";
import { buttonClasses } from "@/components/ui/button";

export function ManualWorkCard({ job, review = false }: { job: ManualJob; review?: boolean }) {
  return <article data-work-source="manual" className="rounded-[var(--radius-surface)] border border-line bg-white p-5 shadow-[var(--shadow-card-compact)]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 className="text-lg font-bold text-ink">PRISM {job.prism_number}</h2>
      <span className="text-sm font-semibold text-ink-soft">Manual · {manualStatusLabels[job.status]}</span>
    </div>
    <p className="mt-2 text-sm text-ink-soft">Registro: {new Intl.DateTimeFormat("es-US", { timeZone: "America/New_York", dateStyle: "medium" }).format(new Date(job.created_at))}</p>
    <Link href={manualJobHref(job.id)} className={`${buttonClasses({ variant: "secondary", size: "sm" })} mt-3`}>
      {review ? "Revisar trabajo manual" : "Ver trabajo manual"}
    </Link>
  </article>;
}
