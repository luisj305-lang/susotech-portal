"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { recoveryClient } from "@/lib/supabase/recovery-client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    const validateRecoveryLink = async () => {
      const parameters = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = parameters.get("access_token");
      const refreshToken = parameters.get("refresh_token");
      const recoveryType = parameters.get("type");

      if (recoveryType !== "recovery" || !accessToken || !refreshToken) {
        if (!mounted) return;
        setChecked(true);
        setMessage("El enlace de recuperación no es válido o ha expirado.");
        return;
      }

      const { error } = await recoveryClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (!mounted) return;
      setChecked(true);

      if (error) {
        setMessage("El enlace de recuperación no es válido, ya fue usado o ha expirado.");
        return;
      }

      window.history.replaceState({}, "", window.location.pathname);
      setIsReady(true);
      setMessage("");
    };

    void validateRecoveryLink();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");

    if (password !== confirmPassword) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }

    if (password.length < 6) {
      setMessage("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setIsLoading(true);

    const { error } = await recoveryClient.auth.updateUser({ password });

    setIsLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Contraseña actualizada. Redirigiendo al login...");
    await recoveryClient.auth.signOut();

    setTimeout(() => {
      router.replace("/login");
      router.refresh();
    }, 1500);
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-card">
        <h1 className="text-2xl font-bold text-brand-900">SUSOTECH</h1>
        <h2 className="mt-2 text-lg font-semibold text-ink">Nueva contraseña</h2>

        {!checked ? (
          <p role="status" className="mt-6 text-sm text-ink-muted">Validando enlace de recuperación...</p>
        ) : isReady ? (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <input
              type="password"
              placeholder="Nueva contraseña"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              disabled={isLoading}
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
            />

            <input
              type="password"
              placeholder="Confirmar contraseña"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={6}
              disabled={isLoading}
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
            />

            <Button type="submit" variant="primary" className="w-full" disabled={isLoading}>
              {isLoading ? "Guardando..." : "Guardar contraseña"}
            </Button>
          </form>
        ) : null}

        {message && <p role="status" className="mt-4 text-sm text-ink-muted">{message}</p>}
      </div>
    </main>
  );
}
