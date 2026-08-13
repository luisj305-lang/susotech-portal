"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>SUSOTECH</h1>
        <h2>Nueva contraseña</h2>

        {!checked ? (
          <p role="status">Validando enlace de recuperación...</p>
        ) : isReady ? (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <input
              type="password"
              placeholder="Nueva contraseña"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              disabled={isLoading}
              style={{ padding: "12px" }}
            />

            <input
              type="password"
              placeholder="Confirmar contraseña"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={6}
              disabled={isLoading}
              style={{ padding: "12px" }}
            />

            <button
              type="submit"
              disabled={isLoading}
              style={{
                padding: "12px",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Guardando..." : "Guardar contraseña"}
            </button>
          </form>
        ) : null}

        {message && <p role="status">{message}</p>}
      </div>
    </main>
  );
}
