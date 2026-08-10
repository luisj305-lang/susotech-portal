import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const root = new URL("../", import.meta.url);
const fixtureUrl = new URL("../.visual-bulk-fixture.json", import.meta.url);
for (const raw of readFileSync(new URL(".env.local", root), "utf8").split(/\r?\n/u)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const split = line.indexOf("=");
  if (split < 1) continue;
  const key = line.slice(0, split).trim();
  let value = line.slice(split + 1).trim();
  if (/^(['"]).*\1$/u.test(value)) value = value.slice(1, -1);
  if (!process.env[key]) process.env[key] = value;
}
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

if (process.argv[2] === "cleanup") {
  if (existsSync(fixtureUrl)) {
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
    await service.auth.admin.deleteUser(fixture.id);
    unlinkSync(fixtureUrl);
  }
  process.exit(0);
}

const suffix = randomBytes(8).toString("hex");
const email = `bulk-visual-${suffix}@example.com`;
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) throw created.error ?? new Error("Fixture identity was not created");
const configured = await service.from("profiles").update({ role: "supervisor", is_active: true, full_name: "Visual bulk supervisor" }).eq("id", created.data.user.id);
if (configured.error) {
  await service.auth.admin.deleteUser(created.data.user.id);
  throw configured.error;
}
writeFileSync(fixtureUrl, JSON.stringify({ id: created.data.user.id, email, password }), { mode: 0o600 });
