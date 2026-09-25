import { randomUUID } from "node:crypto";
import { cleanupExpiredRecruitment } from "@/lib/recruitment/cleanup";
import { createServiceClient } from "@/lib/supabase/service";
import { parsePublicApplication, PublicApplicationError, RESUME_BUCKET } from "@/lib/recruitment/public-input";
import { checkPublicRequest, consumePublicLimit, publicFailure, publicResponse, readPublicJson } from "@/lib/recruitment/public-http";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(request: Request) { return publicResponse(request, null, 204); }

export async function POST(request: Request) {
  try {
    checkPublicRequest(request);
    const parsed = parsePublicApplication(await readPublicJson(request));
    await consumePublicLimit(request, "reserve");
    const db = createServiceClient();
    const columns = "id,submission_token_hash,submission_state,submission_expires_at,resume_path";
    const previous = await db.from("recruitment_applications").select(columns).eq("submission_key", parsed.submissionKey).maybeSingle();
    if (previous.error) throw new Error("Reservation lookup failed");
    let row = previous.data;
    if (!row) {
      await cleanupExpiredRecruitment();
      const id = randomUUID();
      const inserted = await db.from("recruitment_applications").insert({
        ...parsed.application, id, submission_key: parsed.submissionKey, submission_token_hash: parsed.tokenHash,
        submission_state: parsed.resume ? "pending" : "submitted", submission_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        submitted_at: parsed.resume ? null : new Date().toISOString(),
        resume_path: parsed.resume ? `${id}/resume.pdf` : null, resume_name: parsed.resume?.name ?? null, resume_size: parsed.resume?.size ?? null,
      }).select(columns).single();
      if (inserted.error?.code === "23505") {
        const concurrent = await db.from("recruitment_applications").select(columns).eq("submission_key", parsed.submissionKey).single();
        if (concurrent.error) throw new Error("Reservation retry failed");
        row = concurrent.data;
      } else if (inserted.error) throw new Error("Reservation failed");
      else row = inserted.data;
    }
    if (!row || row.submission_token_hash !== parsed.tokenHash) throw new PublicApplicationError("La solicitud no es válida.", 409);
    if (row.submission_state === "submitted") return publicResponse(request, { status: "submitted", id: row.id });
    if (new Date(row.submission_expires_at).getTime() <= Date.now()) throw new PublicApplicationError("El intento venció. Vuelve a enviar el formulario.", 410);
    if (!row.resume_path) throw new Error("Missing upload path");
    const signed = await db.storage.from(RESUME_BUCKET).createSignedUploadUrl(row.resume_path, { upsert: false });
    if (signed.error || !signed.data) throw new Error("Signing failed");
    return publicResponse(request, { status: "pending", id: row.id, upload: { url: signed.data.signedUrl } }, 201);
  } catch (error) { return publicFailure(request, error); }
}
