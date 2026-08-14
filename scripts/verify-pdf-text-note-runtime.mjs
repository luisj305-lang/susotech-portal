import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const raw of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/u)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const split = line.indexOf("=");
  if (split < 1 || process.env[line.slice(0, split)]) continue;
  process.env[line.slice(0, split)] = line.slice(split + 1).trim().replace(/^(['"])(.*)\1$/u, "$2");
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !serviceKey) throw new Error("Missing Supabase environment variables");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const email = `pdf-note-${randomBytes(8).toString("hex")}@example.com`;
let userId;
try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("User creation failed");
  userId = created.data.user.id;
  const client = createClient(url, anon, options);
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const annotationId = crypto.randomUUID();
  const direct = await client.from("job_pdf_text_annotations").insert({
    id: annotationId,
    job_id: crypto.randomUUID(), delivery_id: crypto.randomUUID(), draft_version: 0,
    source_document_id: crypto.randomUUID(), page: 1, source_page: 1, text: "Denied",
    box_x: 0.1, box_y: 0.1, box_width: 0.2, box_height: 0.1,
    font_size_ratio: 0.02, created_by: userId,
  });
  if (!direct.error) throw new Error("Direct text annotation DML was not denied");
  const updated = await client.from("job_pdf_text_annotations").update({ text: "Denied update" }).eq("id", annotationId);
  if (!updated.error) throw new Error("Direct text annotation UPDATE was not denied");
  const deleted = await client.from("job_pdf_text_annotations").delete().eq("id", annotationId);
  if (!deleted.error) throw new Error("Direct text annotation DELETE was not denied");
  console.log("[pdf-text-note-runtime] PASS direct authenticated INSERT/UPDATE/DELETE denied");
} finally {
  if (userId) await service.auth.admin.deleteUser(userId);
}
