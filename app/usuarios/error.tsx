"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function UsersError({ reset }: { reset: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-white p-6">
      <ErrorState
        title="No pudimos cargar los usuarios"
        description="No se modificaron los datos. Puedes volver a intentar."
        onRetry={() => reset()}
      />
    </div>
  );
}
