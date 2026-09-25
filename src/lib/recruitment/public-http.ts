import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createServiceClient } from "@/lib/supabase/service";
import { allowedRecruitmentOrigin, PublicApplicationError } from "./public-input";

export function publicResponse(request: Request, body: unknown, status = 200) {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" });
  const origin = request.headers.get("origin");
  if (allowedRecruitmentOrigin(origin, process.env.NODE_ENV === "production")) {
    headers.set("Access-Control-Allow-Origin", origin!);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  if (status === 429) headers.set("Retry-After", "3600");
  return status === 204 ? new Response(null, { status, headers }) : Response.json(body, { status, headers });
}

export function checkPublicRequest(request: Request) {
  if (!allowedRecruitmentOrigin(request.headers.get("origin"), process.env.NODE_ENV === "production")) throw new PublicApplicationError("Origen no permitido.", 403);
  if (process.env.RECRUITMENT_ENABLED !== "true" || !process.env.RECRUITMENT_RATE_LIMIT_SECRET || process.env.RECRUITMENT_RATE_LIMIT_SECRET.length < 32) throw new PublicApplicationError("Las solicitudes aún no están habilitadas. Inténtalo más tarde.", 503);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new PublicApplicationError("Formato de solicitud no permitido.", 415);
}

export async function readPublicJson(request: Request) {
  const limit = 32 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new PublicApplicationError("La solicitud es demasiado grande.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PublicApplicationError("La solicitud está vacía.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new PublicApplicationError("La solicitud es demasiado grande.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new PublicApplicationError("La solicitud no es válida."); }
}

export async function consumePublicLimit(request: Request, stage: "reserve" | "finalize") {
  // Vercel overwrites X-Forwarded-For. Do not trust arbitrary forwarded IPs off-platform.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : process.env.NODE_ENV !== "production" ? "127.0.0.1" : null;
  if (!ip || !isIP(ip)) throw new PublicApplicationError("No se pudo verificar la solicitud.", 503);
  const key = createHmac("sha256", process.env.RECRUITMENT_RATE_LIMIT_SECRET!).update(`${stage}:${ip}`).digest("hex");
  const { data, error } = await createServiceClient().rpc("consume_recruitment_rate_limit", { p_key: key });
  if (error) throw new PublicApplicationError("No se pudo procesar la solicitud. Inténtalo más tarde.", 503);
  if (data !== true) throw new PublicApplicationError("Alcanzaste el límite de intentos. Vuelve a intentarlo en una hora.", 429);
}

export function publicFailure(request: Request, error: unknown) {
  return error instanceof PublicApplicationError
    ? publicResponse(request, { message: error.message }, error.status)
    : publicResponse(request, { message: "No se pudo completar la solicitud. Inténtalo nuevamente." }, 503);
}
