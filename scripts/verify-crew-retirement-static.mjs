import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [sql, crewsPage, jobsPage, dashboard, queries, selector, actions, bulkCore] = await Promise.all([
  read("supabase/migrations/20260813039000_retire_new_crew_operations.sql"),
  read("app/equipos/page.tsx"),
  read("app/trabajos/page.tsx"),
  read("src/components/dashboard-client.tsx"),
  read("src/lib/jobs/queries.ts"),
  read("src/components/jobs/assignee-select.tsx"),
  read("src/lib/jobs/actions.ts"),
  read("src/lib/storage/bulk-import-core.ts"),
]);

assert.match(sql, /revoke insert, update, delete on public\.crews from authenticated/u);
assert.match(sql, /revoke insert, update, delete on public\.crew_members from authenticated/u);
assert.match(sql, /New crew assignments are retired/u);
assert.match(sql, /Retired crew assignments cannot be reactivated/u);
assert.doesNotMatch(sql, /\b(?:drop|truncate|delete from)\s+public\.(?:crews|crew_members|job_assignments)\b/iu);

assert.match(crewsPage, /redirect\("\/trabajos"\)/u);
assert.doesNotMatch(jobsPage, /href="\/equipos"/u);
assert.doesNotMatch(dashboard, /href="\/equipos"|Administrar equipos/u);
assert.doesNotMatch(selector, /Crews \/ equipos|crew:\$\{option\.id\}/u);
assert.match(queries, /listAssigneeOptions[\s\S]*listActiveTechniciansCore/u);
assert.match(queries, /from\("crews"\)\.select\("id,name"\)/u, "historical crew labels must remain readable");
assert.match(actions, /assigneeType !== null && assigneeType !== "technician"/u);
assert.match(bulkCore, /Solo se permiten responsables individuales/u);

console.log("PASS crew retirement static checks");
