"use client";

import { buttonClasses } from "@/components/ui/button";

/**
 * Client-side filter toggle chip for local-state filtering.
 *
 * Unlike `FilterChip` (a form submit button for server GET forms), this chip
 * drives a local `onClick` state update and reports its pressed state through
 * `aria-pressed` for assistive tech.
 */
export function FilterToggleChip({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })}
    >
      {label}
    </button>
  );
}
