"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  discardFuelPhotoUpload,
  prepareFuelPhotoUpload,
  startTechnicianShift,
} from "@/lib/work-shifts/actions";
import { supabase } from "@/lib/supabase/client";

const allowedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const moneyPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u;

export function StartShiftForm() {
  const router = useRouter();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [fuelChoice, setFuelChoice] = useState<"yes" | "no" | null>(null);
  const [amount, setAmount] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const clearPhoto = () => {
    setPhoto(null);
    if (cameraInput.current) cameraInput.current.value = "";
    if (galleryInput.current) galleryInput.current.value = "";
  };

  const chooseFuel = (choice: "yes" | "no") => {
    setFuelChoice(choice);
    setMessage("");
    if (choice === "no") {
      setAmount("0");
      clearPhoto();
    } else if (amount === "0") {
      setAmount("");
    }
  };

  const selectPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!allowedPhotoTypes.includes(file.type) || file.size < 1 || file.size > MAX_PHOTO_BYTES) {
      clearPhoto();
      setMessage("La foto debe ser JPG, PNG o WebP y no superar 10 MB.");
      return;
    }
    setPhoto(file);
    setMessage("");
  };

  const submit = () => {
    if (!fuelChoice) {
      setMessage("Indica si compraste gasolina hoy.");
      return;
    }
    if (fuelChoice === "yes"
      && (!moneyPattern.test(amount) || /^0(?:\.0{1,2})?$/u.test(amount))) {
      setMessage("Ingresa un monto mayor que cero con máximo dos decimales.");
      return;
    }

    startTransition(async () => {
      setMessage(photo ? "Subiendo foto de gasolina…" : "Iniciando jornada…");
      let uploadedPath: string | null = null;
      try {
        if (fuelChoice === "yes" && photo) {
          const prepared = await prepareFuelPhotoUpload({
            mimeType: photo.type,
            size: photo.size,
          });
          if (!prepared.success) {
            setMessage(prepared.message);
            return;
          }
          uploadedPath = prepared.data.path;
          const { error } = await supabase.storage
            .from("technician-shift-fuel")
            .uploadToSignedUrl(prepared.data.path, prepared.data.token, photo, {
              contentType: photo.type,
            });
          if (error) {
            await discardFuelPhotoUpload({ path: prepared.data.path });
            setMessage("No se pudo subir la foto. Puedes reintentar.");
            return;
          }
        }

        setMessage("Iniciando jornada…");
        const result = await startTechnicianShift({
          noFuelToday: fuelChoice === "no",
          fuelAmount: fuelChoice === "no" ? "0" : amount,
          fuelPhotoPath: uploadedPath,
        });
        setMessage(result.message);
        if (result.success) {
          clearPhoto();
          router.replace("/dashboard");
          router.refresh();
        }
      } catch {
        setMessage("No se pudo iniciar la jornada. Intenta nuevamente.");
      }
    });
  };

  return (
    <section className="grid gap-6 rounded-3xl border border-black/20 bg-white p-5 shadow-2xl sm:p-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-black/60">
          Registro de jornada
        </p>
        <h1 className="mt-2 text-3xl font-bold">Iniciar jornada</h1>
        <p className="mt-2 text-sm leading-6 text-black/70">
          Registra tu jornada y la información de gasolina de hoy.
        </p>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-lg font-bold">¿Compraste gasolina hoy?</legend>
        <button
          type="button"
          aria-pressed={fuelChoice === "yes"}
          disabled={pending}
          onClick={() => chooseFuel("yes")}
          className={`min-h-16 rounded-2xl border px-5 text-left text-lg font-bold transition disabled:opacity-60 ${fuelChoice === "yes" ? "border-black bg-black text-white" : "border-black/40 bg-white text-black"}`}
        >
          Sí, cargué gasolina
        </button>
        <button
          type="button"
          aria-pressed={fuelChoice === "no"}
          disabled={pending}
          onClick={() => chooseFuel("no")}
          className={`min-h-16 rounded-2xl border px-5 text-left text-lg font-bold transition disabled:opacity-60 ${fuelChoice === "no" ? "border-black bg-black text-white" : "border-black/40 bg-white text-black"}`}
        >
          No cargué gasolina
        </button>
      </fieldset>

      {fuelChoice === "yes" && (
        <div className="grid gap-5 border-t border-black/20 pt-5">
          <label className="grid gap-2 font-semibold">
            Monto total gastado en USD
            <div className="flex min-h-14 items-center rounded-xl border border-black/50 bg-white px-4 focus-within:border-black">
              <span aria-hidden="true" className="mr-2 text-black/60">$</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(",", "."))}
                pattern="(?:0|[1-9][0-9]{0,9})(?:[.][0-9]{1,2})?"
                maxLength={13}
                placeholder="0.00"
                required
                disabled={pending}
                className="min-w-0 flex-1 bg-transparent py-3 text-lg outline-none"
              />
            </div>
            <span className="text-xs font-normal text-black/60">Máximo dos decimales.</span>
          </label>

          <div className="grid gap-3">
            <div>
              <p className="font-semibold">Fotografía del marcador</p>
              <p className="text-sm text-black/60">Opcional · JPG, PNG o WebP · máximo 10 MB</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label aria-disabled={pending} className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border border-black/50 px-3 text-center font-semibold has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                Tomar foto
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={pending}
                  onChange={selectPhoto}
                  className="sr-only"
                />
              </label>
              <label aria-disabled={pending} className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border border-black/50 px-3 text-center font-semibold has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                Elegir de galería
                <input
                  ref={galleryInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={pending}
                  onChange={selectPhoto}
                  className="sr-only"
                />
              </label>
            </div>
            {photo && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-black/20 p-3 text-sm">
                <span className="min-w-0 truncate">{photo.name}</span>
                <button type="button" disabled={pending} onClick={clearPhoto} className="font-bold underline">
                  Quitar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {fuelChoice === "no" && (
        <p className="rounded-xl border border-black/20 bg-white p-4 text-sm text-black/70">
          Se registrará explícitamente que hoy no compraste gasolina, con monto $0.00.
        </p>
      )}

      <button
        type="button"
        disabled={pending || !fuelChoice}
        onClick={submit}
        className="min-h-16 rounded-2xl bg-black px-5 text-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Procesando…" : "Empezar jornada"}
      </button>
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-black/80">
        {message}
      </p>
    </section>
  );
}
