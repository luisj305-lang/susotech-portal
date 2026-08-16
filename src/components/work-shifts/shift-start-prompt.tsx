"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { StartShiftForm } from "./start-shift-form";

const promptKey = (technicianId: string) => `technician-shift-prompt:${technicianId}`;
const promptChangeEvent = "technician-shift-prompt-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(promptChangeEvent, onStoreChange);
  return () => window.removeEventListener(promptChangeEvent, onStoreChange);
}

export function ShiftStartPrompt({ technicianId, active }: { technicianId: string; active: boolean }) {
  const visible = useSyncExternalStore(
    subscribe,
    () => !active && sessionStorage.getItem(promptKey(technicianId)) !== "dismissed",
    () => false,
  );

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(promptKey(technicianId), "dismissed");
    window.dispatchEvent(new Event(promptChangeEvent));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-brand-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="shift-prompt-title">
      <div className="grid w-full max-w-lg gap-3 rounded-2xl bg-white p-6 text-ink shadow-card">
        <h2 id="shift-prompt-title" className="px-2 pt-2 text-2xl font-bold text-ink">¿Vas a comenzar tu jornada?</h2>
        <StartShiftForm />
        <Button type="button" variant="secondary" onClick={dismiss} className="min-h-12 w-full">
          Esta vez no estoy en jornada
        </Button>
      </div>
    </div>
  );
}
