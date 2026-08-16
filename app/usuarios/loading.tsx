import { Skeleton } from "@/components/ui/skeleton";

export default function UsersLoading() {
  return (
    <div className="min-h-screen bg-white px-4 py-8 sm:px-8" aria-busy="true">
      <span className="sr-only">Cargando usuarios…</span>
      <div className="mx-auto w-full max-w-[1400px] space-y-6">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((item) => <Skeleton key={item} className="h-40 rounded-2xl" />)}
        </div>
      </div>
    </div>
  );
}
