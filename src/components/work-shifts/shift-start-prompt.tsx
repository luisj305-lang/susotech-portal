"use client";

import { useSyncExternalStore } from "react";
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
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="shift-prompt-title">
      <div className="grid w-full max-w-lg gap-3 rounded-3xl bg-white p-4 text-black shadow-2xl">
        <h2 id="shift-prompt-title" className="px-2 pt-2 text-2xl font-bold">¿Vas a comenzar tu jornada?</h2>
        <StartShiftForm />
        <button type="button" onClick={dismiss} className="min-h-12 rounded-xl border border-black bg-white px-5 font-bold text-black">
          Esta vez no estoy en jornada
        </button>
      </div>
    </div>
  );
}
