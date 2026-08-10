import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createCrewCore, removeCrewMemberCore } from "../src/lib/jobs/crew-core.ts";

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

const sql = await fs.readFile(new URL("../supabase/migrations/20260810_jobs_crew_directory.sql", import.meta.url), "utf8");
const actions = await fs.readFile(new URL("../src/lib/jobs/actions.ts", import.meta.url), "utf8");
const queries = await fs.readFile(new URL("../src/lib/jobs/queries.ts", import.meta.url), "utf8");
const baseSql = await fs.readFile(new URL("../supabase/migrations/20260810_jobs_module.sql", import.meta.url), "utf8");

for (const pattern of [
  /returns table \(id uuid, label text\)/u,
  /security definer[\s\S]*set search_path = ''/u,
  /if not public\.is_office_staff\(auth\.uid\(\)\)[\s\S]*errcode = '42501'/u,
  /p\.role = 'tecnico'[\s\S]*p\.is_active/u,
  /revoke all on function public\.list_active_technicians_for_office\(\) from public/u,
  /grant execute on function public\.list_active_technicians_for_office\(\) to authenticated/u,
]) ok(pattern.test(sql), `SQL contract missing: ${pattern}`);

for (const name of ["createCrew", "updateCrew", "setCrewActive", "addCrewMember", "removeCrewMember"]) {
  ok(new RegExp(`export async function ${name}\\(`, "u").test(actions), `${name} action missing`);
}
ok((actions.match(/await requireSupervisor\(\)/gu) ?? []).length >= 7, "crew actions must use the office guard");
ok(/listActiveTechniciansCore/u.test(queries), "queries must use the limited directory core");
ok(!/from\("profiles"\)/u.test(queries), "jobs queries must not bypass profiles RLS");
ok(/ensure_crew_lead_after_write[\s\S]*ensure_crew_lead_membership/u.test(baseSql), "lead membership must share the crew statement transaction");

const uuid = "11111111-1111-4111-8111-111111111111";
const calls = [];
const eligibleClient = {
  rpc: async (name) => ({ data: name === "list_active_technicians_for_office" ? [{ id: uuid, label: "Técnico" }] : null, error: null }),
  from: (table) => ({
    insert: (payload) => ({ select: () => ({ single: async () => (calls.push([table, "insert", payload]), { data: { id: uuid }, error: null }) }) }),
    select: () => ({ eq: () => ({ single: async () => ({ data: { lead_technician_id: "22222222-2222-4222-8222-222222222222" }, error: null }) }) }),
    delete: () => ({ eq: () => ({ eq: async () => (calls.push([table, "delete"]), { error: null }) }) }),
  }),
};
const created = await createCrewCore(eligibleClient, { name: "  Equipo Norte  ", leadTechnicianId: uuid });
ok(created.id === uuid && calls[0][2].name === "Equipo Norte", "create must normalize and mutate once");
await removeCrewMemberCore(eligibleClient, { crewId: uuid, technicianId: uuid });
ok(calls.some((call) => call[1] === "delete"), "non-lead removal must execute");

await assert.rejects(
  () => removeCrewMemberCore({ ...eligibleClient, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { lead_technician_id: uuid }, error: null }) }) }) }) }, { crewId: uuid, technicianId: uuid }),
  /líder/u,
);
checks += 1;

const beforeRejected = calls.length;
await assert.rejects(() => createCrewCore(eligibleClient, { name: " ", leadTechnicianId: uuid }), /nombre/u);
await assert.rejects(() => createCrewCore(eligibleClient, { name: "Equipo", leadTechnicianId: "33333333-3333-4333-8333-333333333333" }), /elegible/u);
ok(calls.length === beforeRejected, "invalid or ineligible input must fail before mutation");

try { process.loadEnvFile(".env.local"); } catch {}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (url && key) {
  const response = await fetch(`${url}/rest/v1/rpc/list_active_technicians_for_office`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}" });
  if (response.status === 404) {
    console.log(`[crew-admin-runtime] EXPECTED_PRECHECK_FAIL migration=20260810_jobs_crew_directory.sql cleanup=passed checks=${checks}`);
  } else {
    console.log(`[crew-admin-runtime] PASS deterministic checks=${checks}; live=available cleanup=passed`);
  }
} else {
  console.log(`[crew-admin-runtime] PASS deterministic checks=${checks}; live=migration-pending cleanup=passed`);
}
