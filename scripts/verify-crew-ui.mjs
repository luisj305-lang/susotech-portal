import assert from "node:assert/strict";
import fs from "node:fs/promises";

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

const [page, dashboard, jobs, selector, actions, migration] = await Promise.all([
  read("../app/equipos/page.tsx"),
  read("../src/components/dashboard-client.tsx"),
  read("../app/trabajos/page.tsx"),
  read("../src/components/jobs/assignee-select.tsx"),
  read("../src/lib/jobs/actions.ts"),
  read("../supabase/migrations/20260813039000_retire_new_crew_operations.sql"),
]);

check(/redirect\("\/trabajos"\)/u.test(page), "/equipos must redirect safely");
check(!dashboard.includes('href="/equipos"'), "dashboard must not link retired crew management");
check(!jobs.includes('href="/equipos"'), "jobs page must not link retired crew management");
check(!/Crews \/ equipos|type:\s*"crew"/u.test(selector), "new assignment selector must not offer crews");
for (const action of ["createCrew", "updateCrew", "setCrewActive", "addCrewMember", "removeCrewMember"]) {
  check(new RegExp(`export async function ${action}\\([\\s\\S]*?CREW_RETIREMENT_MESSAGE`, "u").test(actions), `${action} must fail closed`);
}
check(/CREW_RETIREMENT_MESSAGE = "La administración de equipos fue retirada/u.test(actions), "retirement message must be explicit");
check(/New crew assignments are retired/u.test(migration), "database must reject new crew assignments");
check(!/drop table\s+(?:if exists\s+)?public\.(?:crews|crew_members|job_assignments)/iu.test(migration), "historical crew tables must remain");

console.log(`[crew-ui] PASS checks=${checks}`);
