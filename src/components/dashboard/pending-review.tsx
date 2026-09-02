import Link from "next/link";
import type { OfficeJobPreview } from "@/lib/jobs/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCamera, IconInbox } from "@/components/ui/icons";

const deliveryDateFormatter = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/New_York",
  dateStyle: "medium",
});

const pdfStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  current: "Vigente",
  stale: "Desactualizado",
};

const smallPrimary =
  "inline-flex min-h-[var(--control-height-sm)] items-center justify-center rounded-[var(--radius-control)] border border-brand-900 bg-brand-900 px-3 text-xs font-semibold text-white shadow-[var(--shadow-control)] transition-colors hover:bg-brand-950";

export function PendingReview({ jobs }: { jobs: OfficeJobPreview[] }) {
  const visible = jobs.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <CardTitle>Pendientes de revisión</CardTitle>
          <Link
            href="/trabajos?status=en_revision"
            className="text-sm font-medium text-accent-600 hover:text-accent-500"
          >
            Ver todos los trabajos pendientes →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {visible.length === 0 ? (
          <EmptyState
            icon={IconInbox}
            title="No hay trabajos pendientes de revisión"
            description="Los trabajos enviados por los técnicos aparecerán aquí."
          />
        ) : (
          <div className="divide-y divide-line px-5 sm:px-6">
            {visible.map((job) => (
              <div
                key={job.id}
                className="flex flex-wrap items-center gap-3 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {job.prism_number
                      ? `PRISM ${job.prism_number}`
                      : "Sin PRISM"}
                  </p>
                  <p className="truncate text-sm font-medium text-ink">
                    {job.address || job.location || "Sin dirección"}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Técnico: {job.assignee_label}
                  </p>
                </div>
                <span className="text-xs text-ink-muted">
                  {deliveryDateFormatter.format(
                    new Date(job.submitted_at ?? job.updated_at),
                  )}
                </span>
                <StatusBadge status="en_revision" />
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  <IconCamera className="h-4 w-4" />
                  {job.photo_count} fotos
                </span>
                <span className="text-xs text-ink-muted">
                  {pdfStatusLabels[job.delivered_pdf_status] ?? "Pendiente"}
                </span>
                <Link
                  href={`/trabajos/${job.id}`}
                  className={smallPrimary}
                >
                  Revisar
                </Link>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
