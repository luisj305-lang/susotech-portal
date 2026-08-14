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
  const technicians = options.filter((option) => option.type === "technician");

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
    </select>
  </div>;
}
