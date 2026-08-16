"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();

  const handleLogout = async () => {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("technician-shift-prompt:")) sessionStorage.removeItem(key);
    }
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      className={cn(buttonClasses({ variant: "secondary", size: "sm" }), className)}
    >
      Cerrar sesión
    </button>
  );
}
