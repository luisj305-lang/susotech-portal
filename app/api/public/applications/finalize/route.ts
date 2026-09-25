import { createServiceClient } from "@/lib/supabase/service";
import { PublicApplicationError, receiptMatches, RESUME_BUCKET, validUuid } from "@/lib/recruitment/public-input";
import { checkPublicRequest, consumePublicLimit, publicFailure, publicResponse, readPublicJson } from "@/lib/recruitment/public-http";
import { validateResumeBytes } from "@/lib/recruitment/resume-validation";

export const runtime = "nodejs";
export const maxDuration = 30;
export function OPTIONS(request: Request) { return publicResponse(request, null, 204); }

export async function POST(request: Request) {
  try {
    checkPublicRequest(request);
    const input = await readPublicJson(request) as { id?: unknown; receiptToken?: unknown } | null;
    if (!input || !validUuid(input.id)) throw new PublicApplicationError("La solicitud no es válida.");
    await consumePublicLimit(request, "finalize");
    const db = createServiceClient();
    const { data: row, error } = await db.from("recruitment_applications")
      .select("id,submission_token_hash,submission_state,submission_expires_at,resume_path,resume_size").eq("id", input.id).maybeSingle();
    if (error) throw new Error("Lookup failed");
    if (!row || !receiptMatches(input.receiptToken, row.submission_token_hash ?? "")) throw new PublicApplicationError("La solicitud no es válida.", 404);
    if (row.submission_state === "submitted") return publicResponse(request, { status: "submitted", id: row.id });
    if (new Date(row.submission_expires_at).getTime() <= Date.now()) throw new PublicApplicationError("El intento venció. Vuelve a enviar el formulario.", 410);
    if (!row.resume_path || row.resume_path !== `${row.id}/resume.pdf`) throw new Error("Missing upload path");
    const downloaded = await db.storage.from(RESUME_BUCKET).download(row.resume_path);
    if (downloaded.error || !downloaded.data) throw new PublicApplicationError("No pudimos verificar el PDF. Reintenta el envío.", 409);
    if (downloaded.data.size !== row.resume_size) throw new PublicApplicationError("El tamaño del PDF no coincide. Selecciona el archivo e inténtalo nuevamente.");
    await validateResumeBytes(new Uint8Array(await downloaded.data.arrayBuffer()));
    const saved = await db.from("recruitment_applications").update({ submission_state: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", row.id).eq("submission_state", "pending").select("id").maybeSingle();
    if (saved.error) throw new Error("Finalization failed");
    // A concurrent finalization can have completed the same immutable reservation.
    if (!saved.data) {
      const confirmed = await db.from("recruitment_applications").select("id").eq("id", row.id).eq("submission_state", "submitted").maybeSingle();
      if (confirmed.error || !confirmed.data) throw new Error("Finalization could not be confirmed");
    }
    return publicResponse(request, { status: "submitted", id: row.id });
  } catch (error) { return publicFailure(request, error); }
}
