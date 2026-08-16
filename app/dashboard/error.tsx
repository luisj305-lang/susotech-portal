"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="min-h-screen bg-white p-6">
      <ErrorState
        title="No pudimos cargar el dashboard"
        description="Intenta nuevamente o verifica tu conexión."
        onRetry={() => reset()}
        retryLabel="Reintentar"
      />
    </main>
  );
}
