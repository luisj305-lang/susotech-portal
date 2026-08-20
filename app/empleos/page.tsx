"use client";

import { useState } from "react";
import Image from "next/image";

export default function EmpleosPage() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/empleos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: String(data.get("full_name") ?? ""),
          phone: String(data.get("phone") ?? ""),
          email: String(data.get("email") ?? ""),
          position: String(data.get("position") ?? ""),
          experience: String(data.get("experience") ?? ""),
          message: String(data.get("message") ?? ""),
        }),
      });
      const result = await response.json();
      setMessage(result.message);
      if (result.success) form.reset();
    } catch {
      setMessage("No se pudo enviar. Reintentá.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-ink">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 pt-8 sm:px-6">
        <Image src="/login/susotech-logo.png" alt="Susotech" width={160} height={58} priority className="h-auto w-[160px]" />
        <a href="/login" className="text-sm font-semibold text-accent-600 hover:text-accent-500">
          Portal interno
        </a>
      </header>

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold sm:text-4xl">Trabajá con nosotros</h1>
        <p className="mt-3 text-ink-soft">
          ¿Tenés experiencia en telecomunicaciones, fibra óptica o trabajo de campo? Dejanos tus datos y te contactaremos cuando surja una oportunidad.
        </p>

        <form onSubmit={submit} className="mt-8 grid gap-4 rounded-2xl border border-line bg-white p-6 shadow-card sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Nombre completo *
            <input name="full_name" required maxLength={200} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Teléfono
            <input name="phone" type="tel" maxLength={30} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Correo electrónico
            <input name="email" type="email" maxLength={200} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Posición de interés
            <select name="position" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none">
              <option value="">Seleccioná una opción</option>
              <option value="Técnico">Técnico</option>
              <option value="Ayudante">Ayudante</option>
              <option value="Oficina">Oficina</option>
              <option value="Otro">Otro</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">
            Experiencia o habilidades
            <textarea name="experience" rows={4} maxLength={4000} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">
            Mensaje (opcional)
            <textarea name="message" rows={3} maxLength={4000} className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none" />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center justify-center rounded-xl border border-brand-900 bg-brand-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-950 disabled:opacity-60"
            >
              {pending ? "Enviando…" : "Enviar solicitud"}
            </button>
            <p role="status" aria-live="polite" className="text-sm text-ink-soft">{message}</p>
          </div>
        </form>
      </section>
    </main>
  );
}
