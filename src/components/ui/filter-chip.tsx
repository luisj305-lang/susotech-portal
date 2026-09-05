import { buttonClasses } from "@/components/ui/button";

/**
 * Server-compatible filter chip rendered as a form submit button.
 *
 * Each chip submits the surrounding GET form with its `name`/`value` pair so
 * filters stay shareable and back-navigable through the URL search params.
 */
export function FilterChip({
  name,
  value,
  label,
  active = false,
}: {
  name: string;
  value: string;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      aria-pressed={active}
      className={buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })}
    >
      {label}
    </button>
  );
}
