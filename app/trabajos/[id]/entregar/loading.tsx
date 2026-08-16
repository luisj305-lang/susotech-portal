import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingDeliveryEditor() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6">
      <p role="status" className="text-sm text-ink-muted">Preparando el editor del PDF…</p>
      <Skeleton className="h-4 w-64" />
    </div>
  );
}
