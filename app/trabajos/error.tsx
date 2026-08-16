"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function JobsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-white p-6">
      <ErrorState
        title="No pudimos cargar los trabajos"
        description="El intento no modificó tus datos. Puedes volver a probar."
        onRetry={() => reset()}
      />
    </div>
  );
}
