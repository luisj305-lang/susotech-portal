"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { FleetFormState } from "@/lib/fleet/actions";

const INITIAL_FLEET_FORM_STATE: FleetFormState = { success: null, message: "" };

export function FleetActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Guardando...",
  className,
  resetOnSuccess = false,
  destructive = false,
}: {
  action: (state: FleetFormState, formData: FormData) => Promise<FleetFormState>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  destructive?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, INITIAL_FLEET_FORM_STATE);

  useEffect(() => {
    if (!state.success) return;
    if (resetOnSuccess) formRef.current?.reset();
    if (state.redirectTo) router.push(state.redirectTo);
    router.refresh();
  }, [resetOnSuccess, router, state.redirectTo, state.success]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={destructive ? "danger" : "primary"} size="sm" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {state.message ? (
          <p
            role="status"
            aria-live="polite"
            className={state.success ? "text-sm font-medium text-green-700" : "text-sm font-medium text-red-700"}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
