"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function CrewsError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-white p-6">
      <ErrorState
        title="No pudimos cargar los equipos"
        description="No se modificaron los datos. Puedes volver a intentar."
        onRetry={() => retry()}
      />
    </div>
  );
}
