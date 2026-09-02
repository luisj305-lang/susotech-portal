import Image from "next/image";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";

export function FieldShell({
  userName,
  children,
}: {
  userName: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 pt-[var(--safe-area-top)] shadow-[var(--shadow-soft)] backdrop-blur">
        <div className="mx-auto flex min-h-14 w-full max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center">
            <Image
              src="/login/susotech-logo.png"
              alt="Susotech"
              width={100}
              height={36}
              priority
              className="h-auto w-[100px]"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="hidden max-w-56 truncate text-sm font-medium text-ink-soft sm:block">
              {userName}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] px-4 pb-[calc(1.5rem+var(--safe-area-bottom))] pt-5 sm:px-6 sm:pt-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
