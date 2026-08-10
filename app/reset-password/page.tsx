"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const recoveryClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: "implicit",
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});

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

    const {
      data: { subscription },
    } = recoveryClient.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setIsReady(true);
        setChecked(true);
        setMessage("");
      }
    });

    void recoveryClient.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      setChecked(true);

      if (session) {
        setIsReady(true);
        setMessage("");
      } else if (error) {
        setMessage(`No se pudo validar el enlace: ${error.message}`);
      } else {
        setMessage("El enlace de recuperación no es válido o ha expirado.");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
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

    setTimeout(() => {
      router.push("/login");
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
