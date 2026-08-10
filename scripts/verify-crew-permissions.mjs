import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (/^(['"]).*\1$/u.test(value)) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(new URL("../.env.local", import.meta.url));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing required Supabase environment variables");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options); // Fixtures and cleanup only.
const anonymous = createClient(url, anonKey, options);
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const userIds = [];
const crewIds = [];
const jobIds = [];
let checks = 0;
let cleanupPassed = false;

function check(condition, label, error) {
  if (!condition) throw new Error(`${label} [${error?.code ?? error?.status ?? "assertion"}]`);
  checks += 1;
}

async function ok(label, request) {
  const result = await request;
  check(!result.error, label, result.error);
  return result.data;
}

async function denied(label, request) {
  const result = await request;
  const empty = Array.isArray(result.data) && result.data.length === 0;
  check(Boolean(result.error) || empty || result.data === null, label, result.error);
}

async function identity(label, role) {
  const email = `crew-permissions-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  userIds.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: true, full_name: `Crew ${label}` }).eq("id", id));
  const client = createClient(url, anonKey, options);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function cleanup() {
  const errors = [];
  if (jobIds.length && (await service.from("jobs").delete().in("id", jobIds)).error) errors.push("jobs");
  if (crewIds.length && (await service.from("crews").delete().in("id", crewIds)).error) errors.push("crews");
  for (const id of [...userIds].reverse()) if ((await service.auth.admin.deleteUser(id)).error) errors.push("users");
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`Cleanup failed [${[...new Set(errors)].join(",")}]`);
}

async function main() {
  const admin = await identity("admin", "admin");
  const supervisor = await identity("supervisor", "supervisor");
  const lead = await identity("lead", "tecnico");
  const newLead = await identity("new-lead", "tecnico");
  const removedOnly = await identity("removed-only", "tecnico");
  const alternative = await identity("alternative", "tecnico");
  const outsider = await identity("outsider", "tecnico");

  const adminDirectory = await ok("admin lists active technicians", admin.client.rpc("list_active_technicians_for_office"));
  check([lead.id, newLead.id, removedOnly.id, alternative.id].every((id) => adminDirectory.some((row) => row.id === id)), "admin directory includes active technicians");
  const supervisorDirectory = await ok("supervisor lists active technicians", supervisor.client.rpc("list_active_technicians_for_office"));
  check(supervisorDirectory.some((row) => row.id === lead.id), "supervisor directory is readable");
  await denied("technician cannot list office directory", lead.client.rpc("list_active_technicians_for_office"));
  await denied("anonymous cannot list office directory", anonymous.rpc("list_active_technicians_for_office"));

  const crew = await ok("admin creates crew", admin.client.from("crews").insert({ name: `Crew Norte ${runId}`, lead_technician_id: lead.id }).select("id,name").single());
  crewIds.push(crew.id);
  await ok("admin adds new leader", admin.client.from("crew_members").insert({ crew_id: crew.id, technician_id: newLead.id }));
  await ok("admin adds removable member", admin.client.from("crew_members").insert({ crew_id: crew.id, technician_id: removedOnly.id }));
  await ok("admin adds alternative member", admin.client.from("crew_members").insert({ crew_id: crew.id, technician_id: alternative.id }));
  const updated = await ok("admin edits crew and changes leader", admin.client.from("crews").update({ name: `Crew Principal ${runId}`, lead_technician_id: newLead.id }).eq("id", crew.id).select("name,lead_technician_id").single());
  check(updated.name.startsWith("Crew Principal") && updated.lead_technician_id === newLead.id, "crew edit and leader change persisted");

  const secondCrew = await ok("admin creates second crew", admin.client.from("crews").insert({ name: `Crew Emergencias ${runId}`, lead_technician_id: lead.id }).select("id").single());
  crewIds.push(secondCrew.id);
  await ok("same technician joins multiple crews", admin.client.from("crew_members").insert({ crew_id: secondCrew.id, technician_id: alternative.id }));

  const supervisorCrews = await ok("supervisor reads crews", supervisor.client.from("crews").select("id,name").in("id", crewIds));
  check(supervisorCrews.length === 2, "supervisor sees both crews");
  const supervisorMembers = await ok("supervisor reads crew members", supervisor.client.from("crew_members").select("crew_id,technician_id").in("crew_id", crewIds));
  check(supervisorMembers.some((row) => row.technician_id === alternative.id), "supervisor sees members");

  await denied("supervisor cannot create crew", supervisor.client.from("crews").insert({ name: `Forbidden ${runId}`, lead_technician_id: lead.id }).select("id"));
  await denied("supervisor cannot edit crew", supervisor.client.from("crews").update({ name: "Forbidden update" }).eq("id", crew.id).select("id"));
  await denied("supervisor cannot add member", supervisor.client.from("crew_members").insert({ crew_id: crew.id, technician_id: outsider.id }).select("crew_id"));
  await denied("supervisor cannot remove member", supervisor.client.from("crew_members").delete().eq("crew_id", crew.id).eq("technician_id", alternative.id).select("crew_id"));
  await denied("technician cannot create crew", outsider.client.from("crews").insert({ name: `Tech forbidden ${runId}`, lead_technician_id: outsider.id }).select("id"));
  await denied("technician cannot edit crew", lead.client.from("crews").update({ name: "Tech forbidden" }).eq("id", crew.id).select("id"));
  await denied("anonymous cannot read crews", anonymous.from("crews").select("id").in("id", crewIds));

  const ownCrew = await ok("crew technician reads own crew", alternative.client.from("crews").select("id").in("id", crewIds));
  check(ownCrew.length === 2, "technician can belong to multiple crews");
  await denied("outsider cannot read foreign crew", outsider.client.from("crews").select("id").eq("id", crew.id));

  const job = await ok("admin creates crew job", admin.client.from("jobs").insert({ title: `Crew access ${runId}` }).select("id").single());
  jobIds.push(job.id);
  await ok("admin assigns job to crew", admin.client.rpc("assign_jobs_atomic", { job_ids: [job.id], new_assignee_type: "crew", new_assignee_id: crew.id }));
  await ok("admin adds valid secondary assignment", admin.client.from("job_assignments").insert({ job_id: job.id, assignee_type: "technician", technician_id: alternative.id, assigned_by: admin.id, is_primary: false }));

  for (const [label, identityValue] of [["leader", newLead], ["member", removedOnly], ["alternative", alternative]]) {
    const rows = await ok(`${label} reads crew job`, identityValue.client.from("jobs").select("id").eq("id", job.id));
    check(rows.length === 1, `${label} crew access is visible`);
  }

  await ok("admin removes member without alternative", admin.client.from("crew_members").delete().eq("crew_id", crew.id).eq("technician_id", removedOnly.id));
  await ok("admin removes member with alternative", admin.client.from("crew_members").delete().eq("crew_id", crew.id).eq("technician_id", alternative.id));
  await denied("removed member loses crew job", removedOnly.client.from("jobs").select("id").eq("id", job.id));
  const alternativeRows = await ok("removed member keeps alternate assignment", alternative.client.from("jobs").select("id").eq("id", job.id));
  check(alternativeRows.length === 1, "alternate assignment preserves access");
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally { try { await cleanup(); } catch (error) { failure ??= error; } }

if (failure) {
  console.error(`[crew-permissions] FAIL ${failure.message} cleanup=${cleanupPassed ? "passed" : "failed"}`);
  process.exitCode = 1;
} else {
  console.log(`[crew-permissions] PASS checks=${checks} cleanup=passed users=${userIds.length} crews=${crewIds.length} jobs=${jobIds.length}`);
}
