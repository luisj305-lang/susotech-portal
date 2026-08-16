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
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-white px-4 sm:px-6">
        <div className="flex items-center">
          <Image
            src="/login/susotech-logo.png"
            alt="Susotech"
            width={100}
            height={36}
            priority
            className="h-auto w-[100px]"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm font-medium text-ink-soft sm:block">
            {userName}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
