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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          {greeting ? (
            <p className="text-sm font-medium text-ink-muted">{greeting}</p>
          ) : null}
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
          {description ? (
            <p className="text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {weekLabel || weekControls ? (
        <div className="flex flex-wrap items-center gap-2">
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
