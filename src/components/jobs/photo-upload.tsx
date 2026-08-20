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
  const [photos, setPhotos] = useState<File[]>([]);
  const [pending, startTransition] = useTransition();

  const previewUrls = useMemo(
    () => photos.map((photo) => URL.createObjectURL(photo)),
    [photos],
  );

  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const selectPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    const valid = files.filter(
      (file) =>
        allowedPhotoTypes.includes(file.type) &&
        file.size >= 1 &&
        file.size <= MAX_PHOTO_BYTES,
    );
    if (valid.length !== files.length) {
      setMessage("Algunas fotos no son JPG, PNG o WebP, o superan 10 MB.");
    } else {
      setMessage("");
    }
    setPhotos((current) => [...current, ...valid]);
  };

  const removePhoto = (index: number) => {
    setPhotos((current) => current.filter((_, i) => i !== index));
  };

  function upload(data: FormData) {
    if (photos.length === 0) {
      setMessage("Selecciona al menos una imagen JPG, PNG o WebP.");
      return;
    }
    const photoType = String(data.get("photoType")) as
      | "before"
      | "after"
      | "evidence";
    const comment = String(data.get("photoComment") ?? "");
    startTransition(async () => {
      const remaining: File[] = [];
      let uploaded = 0;
      for (const photo of photos) {
        const prepared = await createPhotoUploadUrl({
          jobId,
          mimeType: photo.type as "image/jpeg" | "image/png" | "image/webp",
          size: photo.size,
        });
        if (!prepared.success) {
          remaining.push(photo);
          continue;
        }
        const { error } = await supabase.storage
          .from("job-evidence")
          .uploadToSignedUrl(prepared.data.path, prepared.data.token, photo, {
            contentType: photo.type,
          });
        if (error) {
          remaining.push(photo);
          continue;
        }
        const confirmed = await addPhotoComment({
          jobId,
          storagePath: prepared.data.path,
          photoType,
          comment,
        });
        if (!confirmed.success) {
          await discardUnconfirmedPhotoUpload({
            jobId,
            path: prepared.data.path,
          });
          remaining.push(photo);
          continue;
        }
        uploaded += 1;
      }
      setPhotos(remaining);
      if (remaining.length === 0) {
        setMessage(`Se subieron ${uploaded} foto(s) correctamente.`);
      } else {
        setMessage(
          `Se subieron ${uploaded} de ${photos.length} foto(s). Las que quedan en la lista no se subieron; reintentá.`,
        );
      }
      router.refresh();
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
            <p className="font-semibold">Fotos</p>
            <p className="text-sm text-ink-muted">
              JPG, PNG o WebP · máximo 10 MB cada una · podés subir varias a la vez
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                aria-disabled={pending}
                className="flex min-h-14 cursor-pointer items-center justify-center rounded-xl border border-line bg-white px-4 text-center font-semibold text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
                Tomar fotos
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  multiple
                  disabled={pending}
                  onChange={selectPhotos}
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
                  multiple
                  disabled={pending}
                  onChange={selectPhotos}
                  className="sr-only"
                />
              </label>
            </div>
            {photos.length > 0 && (
              <ul className="grid gap-2">
                {photos.map((photo, index) => (
                  <li
                    key={`${photo.name}-${index}`}
                    className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm text-ink"
                  >
                    {previewUrls[index] && (
                      <Image
                        src={previewUrls[index]}
                        alt={`Vista previa de ${photo.name}`}
                        width={64}
                        height={64}
                        className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
                        unoptimized
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{photo.name}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => removePhoto(index)}
                      className="font-bold text-accent-600 underline disabled:opacity-60"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
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
            Comentario de estas fotos{" "}
            <span className="font-normal text-ink-muted">(opcional)</span>
            <textarea
              name="photoComment"
              rows={2}
              maxLength={2000}
              className="rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink focus:border-accent-500 focus:outline-none"
            />
          </label>
          <Button
            disabled={pending || photos.length === 0}
            variant="primary"
            size="lg"
          >
            {pending ? "Subiendo…" : "Subir fotos"}
          </Button>
          {photos.length === 0 && (
            <p className="text-sm text-ink-muted">Selecciona una o más fotos para subir.</p>
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
      <UploadFeedback
        message={message}
        pendingFile={photos.length ? `${photos.length} foto(s)` : ""}
      />
    </section>
  );
}
