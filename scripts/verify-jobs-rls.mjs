import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Server-only integration harness. Never import this file from application code.
function loadEnv(path) {
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(new URL("../.env.local", import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing required Supabase server environment variables");

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, clientOptions);
const anonymous = createClient(url, anonKey, clientOptions);
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const userIds = [];
const jobIds = [];
const crewIds = [];
const objects = [];
let passed = 0;
let cleanupPassed = false;

function fail(label, error) {
  const code = error?.code ?? error?.status ?? "assertion";
  throw new Error(`${label} [${code}]`);
}

function check(condition, label, error) {
  if (!condition) fail(label, error);
  passed += 1;
}

async function ok(label, request) {
  const result = await request;
  check(!result.error, label, result.error);
  return result.data;
}

async function denied(label, request) {
  const result = await request;
  const noRows = Array.isArray(result.data) && result.data.length === 0;
  check(Boolean(result.error) || noRows || result.data === null, label);
}

async function privateObject(label, client, bucket, path) {
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  const response = await fetch(data.publicUrl);
  check(!response.ok, label);
}

function roleClient() {
  return createClient(url, anonKey, clientOptions);
}

async function createIdentity(label, role, isActive = true) {
  const email = `jobs-rls-${runId}-${label}@example.com`;
  const created = await ok(`create ${label} identity`, service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  }));
  const id = created.user?.id;
  check(Boolean(id), `created ${label} identity has id`);
  userIds.push(id);
  await ok(`configure ${label} profile`, service.from("profiles").update({
    role,
    is_active: isActive,
    full_name: `RLS ${label}`,
  }).eq("id", id));
  const client = roleClient();
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function startShift(identity, label) {
  const data = await ok(`${label} starts active shift`, identity.client.rpc("start_technician_shift", {
    p_no_fuel_today: true,
    p_fuel_amount: 0,
    p_fuel_photo_path: null,
  }));
  check(Boolean(data?.[0]?.shift_id), `${label} active shift created`);
}

async function cleanup() {
  const errors = [];
  for (const bucket of ["project-files", "job-evidence"]) {
    const paths = objects.filter((item) => item.bucket === bucket).map((item) => item.path);
    if (paths.length) {
      const result = await service.storage.from(bucket).remove(paths);
      if (result.error) errors.push(`storage:${bucket}`);
    }
  }
  if (jobIds.length) {
    const result = await service.from("jobs").delete().in("id", jobIds);
    if (result.error) errors.push("jobs");
  }
  if (crewIds.length) {
    const result = await service.from("crews").delete().in("id", crewIds);
    if (result.error) errors.push("crews");
  }
  if (userIds.length) {
    const result = await service.from("technician_shifts").delete().in("technician_id", userIds);
    if (result.error) errors.push("shifts");
  }
  for (const id of [...userIds].reverse()) {
    const result = await service.auth.admin.deleteUser(id);
    if (result.error) errors.push("identity");
  }
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`Cleanup failed [${[...new Set(errors)].join(",")}]`);
}

async function main() {
  const admin = await createIdentity("admin", "admin");
  const supervisor = await createIdentity("supervisor", "supervisor");
  const direct = await createIdentity("direct", "tecnico");
  const crewTech = await createIdentity("crew", "tecnico");
  const other = await createIdentity("other", "tecnico");
  const inactive = await createIdentity("inactive", "tecnico", false);
  await startShift(direct, "direct technician");
  await startShift(crewTech, "crew technician");
  await startShift(other, "unassigned technician");

  const tables = [
    "jobs", "crews", "crew_members", "job_assignments",
    "job_status_history", "job_production_codes", "job_photos",
  ];
  for (const table of tables) {
    await ok(`table ${table} exists`, admin.client.from(table).select("*", { head: true, count: "exact" }));
  }

  const directJob = await ok("admin creates direct job", admin.client.from("jobs").insert({
    title: `RLS direct ${runId}`,
  }).select("id, category, main_status").single());
  check(directJob.category === "categoria_1" && directJob.main_status === "asignado", "job defaults are enforced");
  jobIds.push(directJob.id);

  const crewJob = await ok("supervisor creates crew job", supervisor.client.from("jobs").insert({
    title: `RLS crew ${runId}`,
  }).select("id").single());
  jobIds.push(crewJob.id);
  const unassignedJob = await ok("admin creates unassigned job", admin.client.from("jobs").insert({
    title: `RLS unassigned ${runId}`,
  }).select("id").single());
  jobIds.push(unassignedJob.id);

  const crew = await ok("admin creates active crew", admin.client.from("crews").insert({
    name: `RLS crew ${runId}`,
    lead_technician_id: crewTech.id,
  }).select("id, is_active").single());
  check(crew.is_active === true, "crew defaults active");
  crewIds.push(crew.id);

  await ok("supervisor assigns direct technician", supervisor.client.from("job_assignments").insert({
    job_id: directJob.id,
    assignee_type: "technician",
    technician_id: direct.id,
    assigned_by: supervisor.id,
  }));
  await ok("supervisor assigns crew", supervisor.client.from("job_assignments").insert({
    job_id: crewJob.id,
    assignee_type: "crew",
    crew_id: crew.id,
    assigned_by: supervisor.id,
  }));
  const membership = await ok("crew lead membership exists", supervisor.client.from("crew_members")
    .select("technician_id").eq("crew_id", crew.id).eq("technician_id", crewTech.id));
  check(membership.length === 1, "crew lead is a member");

  await ok("supervisor updates office field", supervisor.client.from("jobs")
    .update({ description: "runtime verified" }).eq("id", unassignedJob.id).select("id").single());
  const officeRows = await ok("admin reads all temporary jobs", admin.client.from("jobs").select("id").in("id", jobIds));
  check(officeRows.length === 3, "admin has full temporary job access");

  const directRows = await ok("direct technician reads assigned job", direct.client.from("jobs").select("id").eq("id", directJob.id));
  check(directRows.length === 1, "direct assignment is visible");
  const crewRows = await ok("crew technician reads crew job", crewTech.client.from("jobs").select("id").eq("id", crewJob.id));
  check(crewRows.length === 1, "crew assignment is visible");
  await denied("unassigned technician cannot read job", other.client.from("jobs").select("id").eq("id", directJob.id));
  await denied("inactive technician cannot read jobs", inactive.client.from("jobs").select("id").in("id", jobIds));
  await denied("anonymous client cannot read jobs", anonymous.from("jobs").select("id").in("id", jobIds));

  const started = await ok("assigned technician starts job", direct.client.from("jobs")
    .update({ main_status: "en_progreso" }).eq("id", directJob.id).select("main_status").single());
  check(started.main_status === "en_progreso", "allowed transition persisted");
  const incident = await ok("assigned technician reports separate incident", direct.client.from("jobs")
    .update({ incident: "no_access", incident_notes: "runtime verification" })
    .eq("id", directJob.id).select("main_status, incident").single());
  check(incident.main_status === "en_progreso" && incident.incident === "no_access", "incident preserves status");

  await denied("technician cannot change office field", direct.client.from("jobs")
    .update({ title: "forbidden" }).eq("id", directJob.id).select("id"));
  const titleCheck = await ok("office field remains unchanged", admin.client.from("jobs").select("title").eq("id", directJob.id).single());
  check(titleCheck.title !== "forbidden", "forbidden office field was not changed");
  await denied("technician cannot reassign", direct.client.from("job_assignments")
    .update({ active: false }).eq("job_id", directJob.id).select("id"));
  const assignmentCheck = await ok("primary assignment remains active", admin.client.from("job_assignments")
    .select("active").eq("job_id", directJob.id).single());
  check(assignmentCheck.active === true, "forbidden reassignment was not applied");

  const catalog = await ok("technician reads production catalog", direct.client.rpc("list_my_production_catalog"));
  check(Boolean(catalog?.[0]?.id), "production catalog contains an activity");
  await ok("technician adds positive production code", direct.client.rpc("add_job_production", {
    p_job_id: directJob.id,
    p_catalog_id: catalog[0].id,
    p_quantity: 1,
    p_production_date: null,
    p_notes: "RLS fixture",
  }));
  await denied("zero production quantity is rejected", direct.client.from("job_production_codes").insert({
    job_id: directJob.id, code: "INVALID", quantity: 0, added_by: direct.id,
  }));
  await denied("other technician cannot add code", other.client.from("job_production_codes").insert({
    job_id: directJob.id, code: "FORBIDDEN", quantity: 1, added_by: other.id,
  }));

  const projectPath = `${directJob.id}/project.pdf`;
  await ok("office uploads private project file", admin.client.storage.from("project-files")
    .upload(projectPath, new Uint8Array([37, 80, 68, 70]), { contentType: "application/pdf" }));
  objects.push({ bucket: "project-files", path: projectPath });
  await ok("assigned technician downloads project", direct.client.storage.from("project-files").download(projectPath));
  await denied("other technician cannot download project", other.client.storage.from("project-files").download(projectPath));
  await denied("anonymous client cannot download project", anonymous.storage.from("project-files").download(projectPath));
  await privateObject("project-files bucket has no public object access", anonymous, "project-files", projectPath);

  const evidencePath = `${directJob.id}/evidence.jpg`;
  await ok("assigned technician uploads evidence object", direct.client.storage.from("job-evidence")
    .upload(evidencePath, new Uint8Array([255, 216, 255, 217]), { contentType: "image/jpeg" }));
  objects.push({ bucket: "job-evidence", path: evidencePath });
  await ok("assigned technician inserts photo metadata", direct.client.from("job_photos").insert({
    job_id: directJob.id, storage_path: evidencePath, photo_type: "evidence", uploaded_by: direct.id,
  }));
  await ok("assigned technician downloads evidence", direct.client.storage.from("job-evidence").download(evidencePath));
  await denied("other technician cannot download evidence", other.client.storage.from("job-evidence").download(evidencePath));
  await denied("inactive technician cannot download evidence", inactive.client.storage.from("job-evidence").download(evidencePath));
  await privateObject("job-evidence bucket has no public object access", anonymous, "job-evidence", evidencePath);

  const history = await ok("assigned technician reads audit history", direct.client.from("job_status_history")
    .select("changed_by").eq("job_id", directJob.id));
  check(history.length === 2 && history.every((entry) => entry.changed_by === direct.id), "status and incident history has correct actor");
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  try {
    await cleanup();
  } catch (error) {
    failure ??= error;
  }
}

if (failure) {
  console.error(`[jobs-rls] FAIL ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`[jobs-rls] PASS checks=${passed} cleanup=${cleanupPassed ? "passed" : "failed"} users=${userIds.length} jobs=${jobIds.length} crews=${crewIds.length} objects=${objects.length}`);
}
