"use client";

import { useState } from "react";
import type { AssigneeOption } from "@/lib/jobs/types";

type Props = {
  name?: string;
  options: AssigneeOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  ariaLabel?: string;
  required?: boolean;
  className?: string;
};

export function AssigneeSelect({
  name,
  options,
  value,
  defaultValue = "",
  onChange,
  ariaLabel,
  required = false,
  className = "rounded-lg border p-3",
}: Props) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => `${option.type}:${option.id}` === selectedValue);
  const technicians = options.filter((option) => option.type === "technician");
  const crews = options.filter((option) => option.type === "crew");

  return <div className="grid gap-2">
    <select
      name={name}
      aria-label={ariaLabel}
      required={required}
      value={selectedValue}
      onChange={(event) => {
        setInternalValue(event.target.value);
        onChange?.(event.target.value);
      }}
      className={className}
    >
      <option value="">Sin asignar</option>
      <optgroup label="Técnicos individuales">
        {technicians.map((option) => <option key={option.id} value={`technician:${option.id}`}>{option.label}</option>)}
      </optgroup>
      <optgroup label="Crews / equipos">
        {crews.map((option) => <option key={option.id} value={`crew:${option.id}`}>{option.label}</option>)}
      </optgroup>
    </select>
    {selected?.type === "technician" && <p className="text-xs text-white">Asignación individual: {selected.label}</p>}
    {selected?.type === "crew" && <div className="rounded-lg bg-black p-2 text-xs text-white">
      <strong className="block">Crew: {selected.label}</strong>
      <span className="block">Líder técnico: {selected.leadLabel}</span>
      <span className="block">Miembros: {selected.members.map((member) => member.label).join(", ") || "Sin miembros"}</span>
    </div>}
  </div>;
}
