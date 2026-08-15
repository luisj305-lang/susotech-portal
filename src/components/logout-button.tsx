"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export function LogoutButton() {
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
      style={{ padding: "10px 16px", cursor: "pointer" }}
    >
      Cerrar sesión
    </button>
  );
}
