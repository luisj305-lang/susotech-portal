"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviseJobAllocations } from "@/lib/jobs/allocation-office-actions";
import type { OfficeAllocationEditorData } from "@/lib/jobs/types";
import { Button } from "@/components/ui/button";

const LOCKED_MESSAGE = "La distribución ya no se puede modificar porque el trabajo está aprobado, facturado, pagado o archivado.";

function toBasisPoints(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Math.round(parsed * 100);
}

export function FinancialAllocationEditor({ data }: { data: OfficeAllocationEditorData }) {
  const router = useRouter();
  const [participantIds, setParticipantIds] = useState<string[]>(data.participantIds);
  const [money, setMoney] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const technician of data.technicians) {
      if (technician.compensationMode === "percentage") initial[technician.id] = "0.00";
    }
    for (const allocation of data.allocations) {
      initial[allocation.participantId] = (allocation.percentageBasisPoints / 100).toFixed(2);
    }
    return initial;
  });
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const locked = data.locked;
  const rosterSet = useMemo(() => new Set(participantIds), [participantIds]);

  const percentageTechnicians = data.technicians.filter((item) => item.compensationMode === "percentage");
  const hourlyTechnicians = data.technicians.filter((item) => item.compensationMode === "hourly");
  const unavailableIds = participantIds.filter((id) => !data.technicians.some((item) => item.id === id));

  const totalBasisPoints = percentageTechnicians.reduce((sum, technician) => {
    if (!rosterSet.has(technician.id)) return sum;
    const basisPoints = toBasisPoints(money[technician.id] ?? "");
    return Number.isFinite(basisPoints) ? sum + basisPoints : sum;
  }, 0);

  const toggleRoster = (id: string) => {
    setMessage("");
    setParticipantIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const setMoneyFor = (id: string, value: string) => {
    setMessage("");
    setMoney((current) => ({ ...current, [id]: value }));
  };

  const save = () => startTransition(async () => {
    if (participantIds.length === 0) {
      setMessage("Agrega al menos un participante al trabajo.");
      return;
    }

    const moneyParticipants = percentageTechnicians.filter((item) => rosterSet.has(item.id));
    for (const technician of moneyParticipants) {
      const basisPoints = toBasisPoints(money[technician.id] ?? "");
      if (!Number.isFinite(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
        setMessage("Cada porcentaje de dinero debe estar entre 0.00% y 100.00%.");
        return;
      }
    }

    const sumBasisPoints = moneyParticipants.reduce((sum, technician) => sum + toBasisPoints(money[technician.id] ?? ""), 0);
    if (sumBasisPoints > 10000) {
      setMessage("La suma de los porcentajes de dinero no puede superar el 100.00%.");
      return;
    }

    const allocations = moneyParticipants
      .map((technician) => ({ participantId: technician.id, percentageBasisPoints: toBasisPoints(money[technician.id] ?? "") }))
      .filter((item) => item.percentageBasisPoints > 0);

    if (allocations.length === 0) {
      setMessage("Asigna al menos un porcentaje de dinero mayor que cero.");
      return;
    }

    const result = await reviseJobAllocations({ jobId: data.jobId, allocations, participantIds });
    setMessage(result.message);
    if (result.success) router.refresh();
  });

  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <h2 className="mb-3 text-lg font-semibold text-ink">Editor de distribución financiera</h2>

      {locked ? (
        <p className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-ink">{LOCKED_MESSAGE}</p>
      ) : (
        <div className="grid gap-5">
          <div>
            <h3 className="text-sm font-semibold text-ink">Participantes con porcentaje de dinero</h3>
            <p className="mt-1 text-xs text-ink-soft">Selecciona a los técnicos que repartirán el dinero del trabajo y asigna su porcentaje. La suma no puede superar el 100.00%.</p>
            <ul className="mt-2 grid gap-2">
              {percentageTechnicians.map((technician) => {
                const inRoster = rosterSet.has(technician.id);
                return (
                  <li key={technician.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={inRoster} disabled={pending} onChange={() => toggleRoster(technician.id)} className="h-4 w-4 shrink-0 accent-brand-900" />
                      <span className="truncate">{technician.label}</span>
                    </label>
                    {inRoster && (
                      <label className="flex items-center gap-1 text-sm text-ink">
                        <input aria-label={`Porcentaje de ${technician.label}`} inputMode="decimal" type="number" min="0" max="100" step="0.01" value={money[technician.id] ?? ""} disabled={pending} onChange={(event) => setMoneyFor(technician.id, event.target.value)} className="w-24 rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
                        <span className="font-semibold">%</span>
                      </label>
                    )}
                  </li>
                );
              })}
              {percentageTechnicians.length === 0 && <li className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-ink-soft">No hay técnicos con pago por porcentaje disponibles.</li>}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Participantes por hora (solo plantel)</h3>
            <p className="mt-1 text-xs text-ink-soft">Estos técnicos forman parte del trabajo pero no reparten dinero; se pagan por nómina.</p>
            <ul className="mt-2 grid gap-2">
              {hourlyTechnicians.map((technician) => {
                const inRoster = rosterSet.has(technician.id);
                return (
                  <li key={technician.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={inRoster} disabled={pending} onChange={() => toggleRoster(technician.id)} className="h-4 w-4 shrink-0 accent-brand-900" />
                      <span className="truncate">{technician.label}</span>
                    </label>
                    <span className="shrink-0 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-soft">Por hora</span>
                  </li>
                );
              })}
              {hourlyTechnicians.length === 0 && <li className="rounded-lg border border-line bg-surface-muted p-3 text-sm text-ink-soft">No hay técnicos con pago por hora disponibles.</li>}
            </ul>
          </div>

          {unavailableIds.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink">Participantes que ya no están activos</h3>
              <p className="mt-1 text-xs text-ink-soft">Debes quitarlos para poder guardar, porque la lista de participantes solo admite técnicos activos.</p>
              <ul className="mt-2 grid gap-2">
                {unavailableIds.map((id) => (
                  <li key={id} className="flex items-center gap-3 rounded-lg border border-line p-3 text-sm text-ink">
                    <span className="flex-1 text-ink-soft">Técnico inactivo</span>
                    <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => toggleRoster(id)}>Quitar</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink">
              Total asignado:{" "}
              <span className={totalBasisPoints > 10000 ? "text-red-600" : ""}>{(totalBasisPoints / 100).toFixed(2)}%</span>
            </p>
            <Button type="button" variant="primary" disabled={pending} onClick={save} className="ml-auto">{pending ? "Guardando…" : "Guardar distribución"}</Button>
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">{message}</p>
    </section>
  );
}
