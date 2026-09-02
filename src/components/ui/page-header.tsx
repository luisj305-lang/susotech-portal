import type { ReactNode } from "react";

export function PageHeader({
  greeting,
  title,
  description,
  actions,
  weekLabel,
  weekControls,
}: {
  greeting?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  weekLabel?: string;
  weekControls?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-stack)]">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div className="space-y-1">
          {greeting ? (
            <p className="text-sm font-medium text-ink-muted">{greeting}</p>
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {description ? (
            <p className="text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>
        ) : null}
      </div>
      {weekLabel || weekControls ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
          {weekLabel ? (
            <span className="text-sm font-medium text-ink-soft">
              {weekLabel}
            </span>
          ) : null}
          {weekControls}
        </div>
      ) : null}
    </div>
  );
}
