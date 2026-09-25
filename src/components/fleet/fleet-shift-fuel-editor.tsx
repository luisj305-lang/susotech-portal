"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setTechnicianShiftFuel } from "@/lib/fleet/actions";

const moneyPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u;

function fuelDisplay(value: string | number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value ?? 0));
}

export function FleetShiftFuelEditor({
  shiftId,
  fuelAmount,
  noFuelToday,
}: {
  shiftId: string;
  fuelAmount: string | number;
  noFuelToday: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(noFuelToday ? "" : String(fuelAmount ?? ""));
  const [noFuel, setNoFuel] = useState(noFuelToday);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setMessage("");
    if (noFuel) {
      startTransition(async () => {
        const result = await setTechnicianShiftFuel({ shiftId, fuelAmount: "0", noFuelToday: true });
        setMessage(result.message);
        if (result.success) router.refresh();
      });
      return;
    }
    const trimmed = amount.trim();
    if (!moneyPattern.test(trimmed) || /^0(?:\.0{1,2})?$/u.test(trimmed)) {
      setMessage("Ingresa un monto mayor que cero con máximo dos decimales.");
      return;
    }
    if (Number(trimmed) > 200) {
      setMessage("El monto de gasolina no puede superar $200.");
      return;
    }
    startTransition(async () => {
      const result = await setTechnicianShiftFuel({ shiftId, fuelAmount: trimmed, noFuelToday: false });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  };

  return (
    <div className="mt-4 grid gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <span className="font-semibold text-ink">Gasolina actual:</span>
        <span>{noFuelToday ? "Sin carga" : fuelDisplay(fuelAmount)}</span>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-ink-soft">
        <input
          type="checkbox"
          checked={noFuel}
          disabled={pending}
          onChange={(event) => setNoFuel(event.currentTarget.checked)}
          className="h-4 w-4 accent-current"
        />
        No cargó gasolina
      </label>
      {!noFuel && (
        <label className="grid gap-1 text-sm font-medium text-ink-soft">
          Monto (USD) · máximo $200.00
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            disabled={pending}
            onChange={(event) => setAmount(event.currentTarget.value.replace(",", "."))}
            placeholder="0.00"
            className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Guardando..." : "Corregir gasolina"}
        </Button>
        {message ? (
          <p role="status" aria-live="polite" className="text-sm font-medium text-ink-soft">{message}</p>
        ) : null}
      </div>
    </div>
  );
}
