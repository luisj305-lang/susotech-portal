"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { recoveryClient } from "@/lib/supabase/recovery-client";
import styles from "./login.module.css";

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

    const { error } = await recoveryClient.auth.resetPasswordForEmail(email, {
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
    <main className={styles.shell}>
      <section className={styles.visual} aria-hidden="true">
        <Image
          src="/login/login-hero.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 767px) 100vw, (max-width: 1199px) 55vw, 65vw"
          className={styles.heroImage}
        />
      </section>

      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}>
          <Image
            src="/login/susotech-logo.png"
            alt="Susotech — Support and Solutions Tech"
            width={1890}
            height={684}
            priority
            className={styles.logo}
          />
        </div>

        <div className={styles.content}>
          <div className={styles.formBlock}>
            <div className={styles.heading}>
              <p className={styles.eyebrow}>Portal Susotech</p>
              <h1 id="login-title">
                {mode === "login" ? "Iniciar sesión" : "Recuperar contraseña"}
              </h1>
              <p>
                {mode === "login"
                  ? "Acceso para personal autorizado."
                  : "Ingresa tu correo y te enviaremos un enlace para continuar."}
              </p>
            </div>

            {mode === "login" ? (
              <>
                <form onSubmit={handleLogin} className={styles.form}>
                  <label className={styles.field}>
                    <span>Correo electrónico</span>
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Contraseña</span>
                    <input
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setMode("recovery")}
                    disabled={isLoading}
                    className={styles.textButton}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>

                  <button
                    type="submit"
                    disabled={isLoading}
                    aria-busy={isLoading}
                    className={styles.primaryButton}
                  >
                    {isLoading ? "Ingresando..." : "Iniciar sesión"}
                  </button>
                </form>
              </>
            ) : (
              <form onSubmit={handleRecovery} className={styles.form}>
                <label className={styles.field}>
                  <span>Correo electrónico</span>
                  <input
                    type="email"
                    name="recovery-email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={isLoading}
                  />
                </label>

                <button
                  type="submit"
                  disabled={isLoading}
                  aria-busy={isLoading}
                  className={styles.primaryButton}
                >
                  {isLoading ? "Enviando..." : "Enviar enlace"}
                </button>

                <button
                  type="button"
                  onClick={() => setMode("login")}
                  disabled={isLoading}
                  className={styles.secondaryButton}
                >
                  Volver al inicio de sesión
                </button>
              </form>
            )}

            {message && (
              <p role="status" aria-live="polite" className={styles.status}>
                {message}
              </p>
            )}
          </div>
        </div>

        <footer className={styles.help}>¿Necesitas ayuda?</footer>
      </section>
    </main>
  );
}
