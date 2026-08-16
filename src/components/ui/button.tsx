import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "dangerSolid" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const sizes: Record<Size, string> = {
  sm: "min-h-10 px-4 text-sm",
  md: "min-h-12 px-5 text-sm",
  lg: "min-h-[52px] px-6 text-base",
};

const variants: Record<Variant, string> = {
  primary: "bg-brand-900 text-white hover:bg-brand-950 border border-brand-900",
  secondary: "bg-white text-brand-900 border border-brand-900 hover:bg-brand-50",
  danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50",
  dangerSolid: "bg-red-600 text-white border border-red-600 hover:bg-red-700",
  ghost: "bg-transparent text-ink-soft hover:bg-surface-muted border border-transparent",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
}: {
  variant?: Variant;
  size?: Size;
} = {}): string {
  return cn(base, sizes[size], variants[variant]);
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  ...props
}: {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  className?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(buttonClasses({ variant, size }), className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {children}
    </button>
  );
}
