import { Button } from "./button";
import { IconAlertTriangle } from "./icons";

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = "Reintentar",
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-amber-500">
        <IconAlertTriangle className="h-7 w-7" />
      </div>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
