"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./admin-dashboard.module.css";

/**
 * Accessible native <dialog> used only by the administrator presentation of
 * the worker-detail modal. It provides initial focus, focus containment and
 * an inert background (via showModal), Escape/cancel dismissal, and focus
 * return to the trigger on close/unmount. Supervisor/technician overlays are
 * unchanged.
 */
export function AdminDashboardDialog({
  open,
  onClose,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      triggerRef.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      className={cn(
        styles.dialog,
        "w-[calc(100vw-2rem)] max-w-lg rounded-[var(--radius-surface)] border border-line bg-white p-5 text-ink shadow-card sm:p-6",
      )}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
