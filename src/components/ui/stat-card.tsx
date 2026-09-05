import type { ComponentType } from "react";
import type { IconProps } from "./icons";
import { cn } from "@/lib/utils";

const tones = {
  green: { bg: "#f0fdf4", text: "#16a34a" },
  blue: { bg: "#eff6ff", text: "#2563eb" },
  amber: { bg: "#fefce8", text: "#ca8a04" },
  emerald: { bg: "#ecfdf5", text: "#059669" },
} as const;

export type StatCardTone = keyof typeof tones;

export function StatCard({
  icon: Icon,
  tone,
  title,
  value,
  sub,
  iconPosition = "left",
  compact = false,
}: {
  icon: ComponentType<IconProps>;
  tone: StatCardTone;
  title: string;
  value: string;
  sub?: string;
  iconPosition?: "left" | "right";
  compact?: boolean;
}) {
  const t = tones[tone];

  const iconChip = (
    <div
      className={cn(
        "grid shrink-0 place-items-center",
        compact ? "h-10 w-10 rounded-lg" : "h-12 w-12 rounded-xl",
      )}
      style={{ backgroundColor: t.bg, color: t.text }}
    >
      <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
    </div>
  );

  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-white shadow-soft",
        compact
          ? "flex min-h-[7.5rem] items-center p-5"
          : "p-6",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-4",
          iconPosition === "right" && "w-full justify-between",
        )}
      >
        {iconPosition === "left" ? iconChip : null}
        <div className="min-w-0">
          <p className={cn("font-medium text-ink-muted", compact ? "text-xs" : "text-sm")}>
            {title}
          </p>
          <p className={cn("font-bold tabular-nums text-ink", compact ? "text-2xl" : "text-3xl")}>
            {value}
          </p>
          {sub ? <p className="text-xs text-ink-muted">{sub}</p> : null}
        </div>
        {iconPosition === "right" ? iconChip : null}
      </div>
    </div>
  );
}
