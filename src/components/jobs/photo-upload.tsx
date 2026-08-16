"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { addPhotoComment } from "@/lib/jobs/actions";
import {
  createPhotoUploadUrl,
  discardUnconfirmedPhotoUpload,
} from "@/lib/storage/actions";
import { supabase } from "@/lib/supabase/client";
import { UploadFeedback } from "./upload-feedback";
import { Button } from "@/components/ui/button";

const allowedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function PhotoUpload({ jobId }: { jobId: string }) {
  const router = useRouter();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const clearPhoto = () => {
    setPhoto(null);
    if (cameraInput.current) cameraInput.current.value = "";
    if (galleryInput.current) galleryInput.current.value = "";
  };

  const selectPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (
      !allowedPhotoTypes.includes(file.type) ||
      file.size < 1 ||
      file.size > MAX_PHOTO_BYTES
    ) {
      clearPhoto();
      setMessage("La foto debe ser JPG, PNG o WebP y no superar 10 MB.");
      return;
    }
    setPhoto(file);
    setMessage("");
  };

  function upload(data: FormData) {
    if (!photo) {
      setMessage("Selecciona una imagen JPG, PNG o WebP.");
      return;
    }
    startTransition(async () => {
      const prepared = await createPhotoUploadUrl({
        jobId,
        mimeType: photo.type as "image/jpeg" | "image/png" | "image/webp",
        size: photo.size,
      });
      if (!prepared.success) {
        setMessage(prepared.message);
        return;
      }
      const { error } = await supabase.storage
        .from("job-evidence")
        .uploadToSignedUrl(prepared.data.path, prepared.data.token, photo, {
          contentType: photo.type,
        });
      if (error) {
        setMessage("No se pudo subir la foto. Puedes reintentar.");
        return;
      }
      const confirmed = await addPhotoComment({
        jobId,
        storagePath: prepared.data.path,
        photoType: String(data.get("photoType")) as
          | "before"
          | "after"
          | "evidence",
        comment: String(data.get("photoComment") ?? ""),
      });
      if (!confirmed.success) {
        await discardUnconfirmedPhotoUpload({
          jobId,
          path: prepared.data.path,
        });
      }
      setMessage(confirmed.message);
      if (confirmed.success) {
        clearPhoto();
        router.refresh();
      }
    });
  }

  function comment(data: FormData) {
    startTransition(async () => {
      const result = await addPhotoComment({
        jobId,
        comment: String(data.get("comment") ?? ""),
      });
      setMessage(result.message);
      if (result.success) router.refresh();
    });
  }

  return (
    <section className="grid gap-6 rounded-2xl border border-line bg-white p-6 text-ink shadow-card">
      <div>
        <h2 className="text-xl font-bold">Evidencia fotográfica</h2>
        <form action={upload} className="mt-4 grid gap-3">
          <div className="grid gap-2">
            <p className="font-semibold">Foto</p>
            <p className="text-sm text-ink-muted">
              JPG, PNG o WebP · máximo 10 MB
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                aria-disabled={pending}
                className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border border-line bg-white px-4 text-center font-semibold text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
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
              <label
                aria-disabled={pending}
                className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border border-line bg-white px-4 text-center font-semibold text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
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
              <div className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm text-ink">
                {previewUrl && (
                  <Image
                    src={previewUrl}
                    alt={`Vista previa de ${photo.name}`}
                    width={64}
                    height={64}
                    className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
                    unoptimized
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{photo.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={clearPhoto}
                  className="font-bold text-accent-600 underline disabled:opacity-60"
                >
                  Quitar
                </button>
              </div>
            )}
          </div>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Tipo
            <select name="photoType" className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none">
              <option value="before">Antes</option>
              <option value="after">Después</option>
              <option value="evidence">Evidencia</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-ink-soft">
            Comentario de esta foto{" "}
            <span className="font-normal text-ink-muted">(opcional)</span>
            <textarea
              name="photoComment"
              rows={2}
              maxLength={2000}
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
            />
          </label>
          <Button
            disabled={pending || !photo}
            variant="primary"
            size="lg"
          >
            {pending ? "Subiendo…" : "Subir foto"}
          </Button>
          {!photo && (
            <p className="text-sm text-ink-muted">Selecciona una foto para subir.</p>
          )}
        </form>
      </div>
      <form action={comment} className="grid gap-3 border-t border-line pt-5">
        <label className="grid gap-1 text-sm font-medium text-ink-soft">
          Comentario general del trabajo
          <textarea
            name="comment"
            required
            rows={3}
            className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
          />
        </label>
        <Button
          disabled={pending}
          variant="secondary"
        >
          Guardar comentario general
        </Button>
      </form>
      <UploadFeedback message={message} pendingFile={photo?.name ?? ""} />
    </section>
  );
}
