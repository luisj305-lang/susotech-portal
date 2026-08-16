import type { ComponentType } from "react";
import type { IconProps } from "./icons";

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
}: {
  icon: ComponentType<IconProps>;
  tone: StatCardTone;
  title: string;
  value: string;
  sub?: string;
}) {
  const t = tones[tone];

  return (
    <div className="rounded-2xl border border-line bg-white p-6 shadow-soft">
      <div className="flex items-center gap-4">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: t.bg, color: t.text }}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-muted">{title}</p>
          <p className="text-3xl font-bold tabular-nums text-ink">{value}</p>
          {sub ? <p className="text-xs text-ink-muted">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}
