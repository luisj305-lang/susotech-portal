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
    <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center sm:px-6 sm:py-14">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-muted text-ink-muted">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
    </div>
  );
}
