import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "./icons";

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-surface-muted text-ink-muted">
        <Icon className="h-7 w-7" />
      </div>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
    </div>
  );
}
