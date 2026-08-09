"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "recovery">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  const handleRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setIsLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Revisa tu correo para continuar con la recuperación.");
    setMode("login");
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

        {mode === "login" ? (
          <>
            <h2>Iniciar sesión</h2>

            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={isLoading}
                style={{ padding: "12px" }}
              />

              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={isLoading}
                style={{ padding: "12px" }}
              />

              <button
                type="submit"
                disabled={isLoading}
                style={{ padding: "12px", cursor: isLoading ? "not-allowed" : "pointer" }}
              >
                {isLoading ? "Ingresando..." : "Iniciar sesión"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => setMode("recovery")}
              disabled={isLoading}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </>
        ) : (
          <>
            <h2>Recuperar contraseña</h2>

            <form onSubmit={handleRecovery} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={isLoading}
                style={{ padding: "12px" }}
              />

              <button
                type="submit"
                disabled={isLoading}
                style={{ padding: "12px", cursor: isLoading ? "not-allowed" : "pointer" }}
              >
                {isLoading ? "Enviando..." : "Enviar enlace"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => setMode("login")}
              disabled={isLoading}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Volver al inicio de sesión
            </button>
          </>
        )}

        {message && <p role="status">{message}</p>}
      </div>
    </main>
  );
}
