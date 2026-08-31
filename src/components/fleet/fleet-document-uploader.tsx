"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import {
  confirmFleetDocumentUpload,
  prepareFleetDocumentUpload,
} from "@/lib/fleet/actions";
import { FLEET_DOCUMENT_TYPES } from "@/lib/fleet/types";

const documentLabels: Record<(typeof FLEET_DOCUMENT_TYPES)[number], string> = {
  registration: "Registro",
  insurance: "Seguro",
  inspection: "Inspección",
  maintenance: "Mantenimiento",
  incident: "Incidencia",
  receipt: "Recibo",
  title: "Título",
  other: "Otro",
};

async function removeStagedDocument(path: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from("fleet-documents").remove([path]);
    return !error;
  } catch {
    return false;
  }
}

export function FleetDocumentUploader({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size < 1) {
      setSuccess(false);
      setMessage("Seleccione un archivo.");
      return;
    }
    setPending(true);
    setMessage("");
    setSuccess(false);
    let stagedPath: string | null = null;
    try {
      const prepared = await prepareFleetDocumentUpload({ vehicleId, mimeType: file.type, size: file.size });
      if (!prepared.success) {
        setMessage(prepared.message);
        return;
      }
      stagedPath = prepared.data.path;
      const uploaded = await supabase.storage.from("fleet-documents").uploadToSignedUrl(
        prepared.data.path,
        prepared.data.token,
        file,
        { contentType: file.type },
      );
      if (uploaded.error) throw new Error("No se pudo cargar el archivo. Verifique su conexión e intente nuevamente.");

      const result = await confirmFleetDocumentUpload({
        vehicleId,
        path: prepared.data.path,
        title: String(formData.get("title") ?? file.name),
        documentType: String(formData.get("document_type") ?? "other"),
        mimeType: file.type,
        size: file.size,
        expiresOn: String(formData.get("expires_on") ?? "") || null,
        notes: String(formData.get("notes") ?? ""),
      });
      if (!result.success) {
        const cleaned = await removeStagedDocument(stagedPath);
        stagedPath = null;
        setMessage(cleaned ? result.message : `${result.message} El archivo temporal requiere limpieza manual.`);
        return;
      }
      stagedPath = null;
      setSuccess(true);
      setMessage(result.message);
      form.reset();
      router.refresh();
    } catch (error) {
      const cleaned = stagedPath ? await removeStagedDocument(stagedPath) : true;
      const actionableMessage = error instanceof Error && error.message.startsWith("No se pudo")
        ? error.message
        : "No se pudo completar la carga. Verifique su conexión e intente nuevamente.";
      setSuccess(false);
      setMessage(cleaned ? actionableMessage : `${actionableMessage} El archivo temporal requiere limpieza manual.`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium text-ink-soft">
        Archivo
        <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="rounded-xl border border-line bg-white px-3 py-2 text-sm" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">
        Título
        <input name="title" required maxLength={300} className="rounded-xl border border-line bg-white px-3 py-2.5" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">
        Tipo
        <select name="document_type" defaultValue="other" className="rounded-xl border border-line bg-white px-3 py-2.5">
          {FLEET_DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{documentLabels[type]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft">
        Vence (opcional)
        <input name="expires_on" type="date" className="rounded-xl border border-line bg-white px-3 py-2.5" />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink-soft sm:col-span-2">
        Notas
        <textarea name="notes" rows={2} maxLength={2000} className="rounded-xl border border-line bg-white px-3 py-2.5" />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Cargando..." : "Cargar documento"}</Button>
        {message ? <p role="status" className={success ? "text-sm text-green-700" : "text-sm text-red-700"}>{message}</p> : null}
      </div>
    </form>
  );
}
