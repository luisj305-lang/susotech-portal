export type StatusTone = {
  bg: string;
  text: string;
  dot: string;
  label?: string;
};

export const STATUS_META: Record<string, StatusTone> = {
  sin_asignar: { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8", label: "Sin asignar" },
  asignado: { bg: "#fff7ed", text: "#9a3412", dot: "#f97316", label: "Asignado" },
  en_revision: { bg: "#fefce8", text: "#854d0e", dot: "#eab308", label: "En revisión" },
  aprobado: { bg: "#f0fdf4", text: "#166534", dot: "#22c55e", label: "Aprobado" },
  facturado: { bg: "#f0fdfa", text: "#115e59", dot: "#14b8a6", label: "Facturado" },
  pagado: { bg: "#ecfdf5", text: "#065f46", dot: "#10b981", label: "Pagado" },
  archivado: { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8", label: "Archivado" },
  incidencia: { bg: "#fef2f2", text: "#991b1b", dot: "#ef4444", label: "Incidencia" },
  activo: { bg: "#f7fee7", text: "#3f6212", dot: "#84cc16", label: "Activo" },
  inactivo: { bg: "#fff1f2", text: "#9f1239", dot: "#e11d48", label: "Inactivo" },
  pdf_pending: { bg: "#fffbeb", text: "#92400e", dot: "#f59e0b", label: "Pendiente" },
  pdf_current: { bg: "#f0fdf4", text: "#166534", dot: "#22c55e", label: "Vigente" },
  pdf_stale: { bg: "#f1f5f9", text: "#475569", dot: "#94a3b8", label: "Desactualizado" },
};

const FALLBACK: StatusTone = {
  bg: "#f1f5f9",
  text: "#475569",
  dot: "#94a3b8",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const meta = STATUS_META[status] ?? FALLBACK;
  const text = label ?? meta.label ?? status;

  return (
    <span
      className={cn("shadow-[var(--shadow-status)]", className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        borderRadius: "var(--radius-pill)",
        padding: "var(--status-padding-y) var(--status-padding-x)",
        fontSize: "var(--status-font-size)",
        fontWeight: 600,
        lineHeight: 1,
        backgroundColor: meta.bg,
        color: meta.text,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: "0.5rem",
          height: "0.5rem",
          borderRadius: "9999px",
          backgroundColor: meta.dot,
          flexShrink: 0,
        }}
      />
      {text}
    </span>
  );
}
import { cn } from "@/lib/utils";
