import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertVariant = "info" | "warning" | "danger" | "success";

const variantClasses: Record<AlertVariant, string> = {
  info: "border-accent-500/30 bg-surface-muted text-ink-soft",
  warning: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
  danger: "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]",
  success: "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]",
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn("rounded-xl border p-4 text-sm", variantClasses[variant], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}
