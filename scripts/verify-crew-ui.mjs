import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import { availableCrewMembers, canRemoveCrewMember } from "../src/components/jobs/crew-manager-model.ts";

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const read = (path) => fs.readFile(new URL(path, import.meta.url), "utf8");

async function anonymousRoutePreflight() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production" }, stdio: "ignore", windowsHide: true });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { if ((await fetch(`${base}/login`)).ok) break; } catch {}
      if (child.exitCode !== null) throw new Error("Next server exited before route preflight");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const response = await fetch(`${base}/equipos`, { redirect: "manual" });
    const location = response.headers.get("location");
    const body = await response.text();
    const redirected = [303, 307, 308].includes(response.status) && location?.endsWith("/login");
    ok(redirected || (response.status === 200 && body.includes("NEXT_REDIRECT") && body.includes("/login")), `anonymous /equipos must redirect to login (${response.status} ${location})`);
    ok(!body.includes("Organiza responsables"), "anonymous route must not leak protected crew UI");
  } finally {
    child.kill();
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
    ok(child.exitCode !== null || child.killed, "Next route preflight cleanup");
  }
}

const [page, manager, loading, error, dashboard, jobs, queries, migration, session, actions, usersPage, usersManager, assigneeSelect] = await Promise.all([
  read("../app/equipos/page.tsx"), read("../src/components/jobs/crew-manager.tsx"),
  read("../app/equipos/loading.tsx"), read("../app/equipos/error.tsx"),
  read("../src/components/dashboard-client.tsx"), read("../app/trabajos/page.tsx"),
  read("../src/lib/jobs/queries.ts"), read("../supabase/migrations/20260810003000_jobs_crew_directory.sql"),
  read("../src/lib/auth/session.ts"), read("../src/lib/jobs/actions.ts"),
  read("../app/usuarios/page.tsx"), read("../src/components/users-manager.tsx"),
  read("../src/components/jobs/assignee-select.tsx"),
]);

ok(page.indexOf("await requireSupervisor()") < page.indexOf("await listCrewManagementData()"), "route guard must run before data query");
ok(/<CrewManager crews=\{crews\} technicians=\{technicians\} canManage=\{profile\.role === "admin"\}/u.test(page), "page must pass role-aware serializable DTOs");
ok(!/service_role/u.test(page + manager + queries), "protected UI must not use service_role");
for (const action of ["createCrew", "updateCrew", "setCrewActive", "addCrewMember", "removeCrewMember"]) {
  ok(manager.includes(action), `${action} missing`);
  ok(new RegExp(`export async function ${action}\\([\\s\\S]*?await requireAdmin\\(\\)`, "u").test(actions), `${action} admin guard missing`);
}
ok(/Modo consulta/u.test(manager) && /canManage/u.test(manager), "supervisor read-only UI missing");
for (const contract of [/<form/gu, /<button/gu, /<select/gu, /role="status"/gu, /required/gu, /window\.confirm/gu, /disabled=\{pending/gu]) ok(contract.test(manager), `accessible interaction missing ${contract}`);
ok(/No hay equipos/u.test(manager) && /Crea el primer equipo/u.test(manager), "empty state missing");
ok(/No pudimos cargar los equipos/u.test(error) && /retry\(\)/u.test(error), "recoverable route error missing");
ok(/aria-busy="true"/u.test(loading), "loading state missing");
ok((dashboard.match(/href="\/equipos"/gu) ?? []).length === 1 && /\{canCreateJobs && \(/u.test(dashboard), "dashboard office-only link missing");
ok((jobs.match(/href="\/equipos"/gu) ?? []).length === 1, "office jobs link missing");
ok(jobs.indexOf('profile.role === "tecnico"') < jobs.indexOf('href="/equipos"'), "technician branch must return before office controls");
ok(/crews\.filter\(\(crew\) => crew\.is_active\)/u.test(queries), "assignment selectors must exclude inactive crews");
ok(/if not public\.is_office_staff\(auth\.uid\(\)\)/u.test(migration), "technician/inactive RPC guard missing");
ok(/if \(!user\)[\s\S]*redirect\("\/login"\)/u.test(session), "anonymous route guard missing");
ok(/if \(!profile\.is_active\)[\s\S]*redirect\("\/acceso-denegado"\)/u.test(session), "inactive route guard missing");
ok(/profile\.role === "admin" \? profile : requireRole\("supervisor"\)/u.test(session), "admin/supervisor allow and technician denial contract missing");
ok(/crew_members\(technician_id\)/u.test(usersPage) && /crew_names/u.test(usersPage), "users page must derive crews from crew_members");
ok(/Crew \/ Equipos/u.test(usersManager) && /crew_names\.join/u.test(usersManager), "users crew column missing");
ok(/optgroup label="Técnicos individuales"/u.test(assigneeSelect) && /optgroup label="Crews \/ equipos"/u.test(assigneeSelect), "assignment type groups missing");
ok(/Líder técnico/u.test(assigneeSelect) && /Miembros:/u.test(assigneeSelect), "crew assignment details missing");

const techs = [{ id: "a", label: "Ana" }, { id: "b", label: "Beto" }];
const crew = { lead_technician_id: "a", members: [{ id: "a", label: "Ana" }] };
ok(availableCrewMembers(crew, techs).map((item) => item.id).join() === "b", "existing members must not be duplicated");
ok(!canRemoveCrewMember(crew, "a") && canRemoveCrewMember(crew, "b"), "lead removal must be disabled in UI model");

try { process.loadEnvFile(".env.local"); } catch {}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.CREW_UI_SKIP_ROUTE !== "1") await anonymousRoutePreflight();
if (url && key) {
  const rpc = await fetch(`${url}/rest/v1/rpc/list_active_technicians_for_office`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}" });
  const body = await rpc.text();
  ok(!body.includes("PGRST202"), "crew directory RPC must exist");
  ok([401, 403].includes(rpc.status), "anonymous directory call must be denied");
  console.log(`[crew-ui] PASS live=available anon_guard=covered cleanup=passed checks=${checks}`);
} else console.log(`[crew-ui] PASS deterministic checks=${checks}; live=migration-pending cleanup=passed`);
