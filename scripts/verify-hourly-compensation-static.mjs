import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("app/usuarios/page.tsx");
const manager = read("src/components/users-manager.tsx");
const actions = read("src/lib/users/actions.ts");
const migration = read("supabase/migrations/20260911080000_fix_technician_compensation_conflict_target.sql");

assert.match(page, /canManage=\{currentProfile\.role === "admin"\}/u,
  "only administrators receive editable compensation controls");
assert.match(actions, /export async function setTechnicianCompensation[\s\S]*?await requireAdmin\(\)/u,
  "the compensation action requires an administrator");
assert.match(manager, /const dollars = Number\.parseFloat\(rateDollars\)[\s\S]*?hourlyRateCents = Math\.round\(dollars \* 100\)/u,
  "the UI converts a dollar rate to integer cents");
assert.match(migration, /where p\.id = p_technician_id and p\.role = 'tecnico' and p\.is_active/u,
  "the RPC accepts only active technicians");
assert.match(migration, /insert into public\.technician_compensation_settings as settings[\s\S]*?returning\s+settings\.technician_id,\s+settings\.mode,\s+settings\.hourly_rate_cents;/u,
  "the RPC qualifies RETURNING columns instead of colliding with RETURNS TABLE variables");
assert.doesNotMatch(migration, /returning\s+technician_id,\s+mode,\s+hourly_rate_cents;/u,
  "the ambiguous unqualified RETURNING list is absent");
assert.match(migration, /on conflict on constraint technician_compensation_settings_pkey/u,
  "the RPC targets the primary key without colliding with the RETURNS TABLE technician_id variable");
assert.doesNotMatch(migration, /on conflict\s*\(\s*technician_id\s*\)/u,
  "the ambiguous inferred ON CONFLICT target is absent");
assert.match(actions, /Admin access required[\s\S]*?Solo un administrador puede configurar el pago\./u,
  "a known authorization failure is actionable without exposing internals");

console.log("[hourly-compensation-static] PASS admin-gate=cents-conversion=active-technician=qualified-returning=constraint-conflict-target");
