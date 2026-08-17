import type { JobStatus } from "@/lib/jobs/types";
import { buttonClasses } from "@/components/ui/button";
import { STATUS_META } from "@/components/ui/status-badge";

type Step = {
  status: JobStatus;
  label: string;
};

const STEPS: Step[] = [
  { status: "asignado", label: "Asignado" },
  { status: "en_revision", label: "En revisión" },
  { status: "aprobado", label: "Aprobado" },
];

function currentIndex(status: JobStatus): number {
  switch (status) {
    case "asignado":
      return 0;
    case "en_revision":
      return 1;
    case "aprobado":
    case "facturado":
    case "pagado":
      return 2;
    default:
      return -1;
  }
}

const lastUpdatedFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function JobProgress({
  status,
  lastUpdated,
}: {
  status: JobStatus;
  lastUpdated?: string | null;
}) {
  const idx = currentIndex(status);

  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <h2 className="text-xl font-bold text-ink">Estado del trabajo</h2>
      <ol className="mt-5 flex items-start">
        {STEPS.map((step, i) => {
          const reached = i <= idx;
          const current = i === idx;
          const meta = STATUS_META[step.status];
          return (
            <li key={step.status} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex w-full items-center">
                {i > 0 ? (
                  <div className={`h-0.5 flex-1 ${i - 1 <= idx ? "bg-brand-300" : "bg-line"}`} />
                ) : (
                  <div className="flex-1" />
                )}
                <span
                  className="h-8 w-8 shrink-0 rounded-full"
                  style={{
                    backgroundColor: reached ? meta.dot : undefined,
                    boxShadow: current ? `0 0 0 2px #ffffff, 0 0 0 4px ${meta.dot}` : undefined,
                  }}
                />
                {i < STEPS.length - 1 ? (
                  <div className={`h-0.5 flex-1 ${i <= idx ? "bg-brand-300" : "bg-line"}`} />
                ) : (
                  <div className="flex-1" />
                )}
              </div>
              <span
                className={`text-center text-xs font-medium ${reached ? "" : "text-ink-muted"}`}
                style={reached ? { color: meta.text } : undefined}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-ink-muted">
          Última actualización:{" "}
          <span className="font-medium text-ink-soft">
            {lastUpdated ? lastUpdatedFormatter.format(new Date(lastUpdated)) : "—"}
          </span>
        </p>
        <a href="#historial" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Ver historial
        </a>
      </div>
    </section>
  );
}
