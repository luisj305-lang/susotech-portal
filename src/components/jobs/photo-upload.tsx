"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPhotoComment } from "@/lib/jobs/actions";
import { createPhotoUploadUrl } from "@/lib/storage/actions";
import { supabase } from "@/lib/supabase/client";
import { UploadFeedback } from "./upload-feedback";

const allowed = ["image/jpeg", "image/png", "image/webp"];

export function PhotoUpload({ jobId }: { jobId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [pendingFile, setPendingFile] = useState("");
  const [pending, startTransition] = useTransition();
  function upload(data: FormData) {
    const file = input.current?.files?.[0];
    if (!file || !allowed.includes(file.type)) { setMessage("Selecciona una imagen JPG, PNG o WebP."); return; }
    startTransition(async () => {
      const prepared = await createPhotoUploadUrl({ jobId, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", size: file.size });
      if (!prepared.success) { setMessage(prepared.message); return; }
      const { error } = await supabase.storage.from("job-evidence").uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: file.type });
      if (error) { setMessage("No se pudo subir la foto. Puedes reintentar."); return; }
      const confirmed = await addPhotoComment({ jobId, storagePath: prepared.data.path, photoType: String(data.get("photoType")) as "before" | "after" | "evidence" });
      setMessage(confirmed.message); if (confirmed.success) { if (input.current) input.current.value = ""; setPendingFile(""); router.refresh(); }
    });
  }
  function comment(data: FormData) {
    startTransition(async () => { const result = await addPhotoComment({ jobId, comment: String(data.get("comment") ?? "") }); setMessage(result.message); if (result.success) router.refresh(); });
  }
  return <section className="grid gap-6 rounded-2xl bg-white p-5 text-slate-950 shadow-lg"><div><h2 className="text-xl font-bold">Evidencia fotográfica</h2><form action={upload} className="mt-4 grid gap-3"><label className="grid gap-1 font-semibold">Foto<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required onChange={(event) => setPendingFile(event.target.files?.[0]?.name ?? "")} className="min-h-12 rounded-xl border p-3" /></label><label className="grid gap-1 font-semibold">Tipo<select name="photoType" className="min-h-12 rounded-xl border p-3"><option value="before">Antes</option><option value="after">Después</option><option value="evidence">Evidencia</option></select></label><button disabled={pending} className="min-h-14 rounded-xl bg-slate-900 px-5 text-lg font-bold text-white disabled:opacity-60">{pending ? "Subiendo…" : "Subir foto"}</button></form></div><form action={comment} className="grid gap-3 border-t pt-5"><label className="grid gap-1 font-semibold">Comentario<textarea name="comment" required rows={3} className="rounded-xl border p-3" /></label><button disabled={pending} className="min-h-14 rounded-xl border-2 border-slate-900 px-5 text-lg font-bold">Guardar comentario</button></form><UploadFeedback message={message} pendingFile={pendingFile} /></section>;
}
