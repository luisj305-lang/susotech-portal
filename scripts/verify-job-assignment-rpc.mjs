import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const userIds = [];
const jobIds = [];
const crewIds = [];
let checks = 0;
let cleanupPassed = false;

function check(condition, label, error) {
  if (!condition) {
    const code = error?.code ?? error?.status ?? "assertion";
    throw new Error(`${label} [${code}]`);
  }
  checks += 1;
}

async function ok(label, request) {
  const result = await request;
  check(!result.error, label, result.error);
  return result.data;
}

async function rejected(label, request) {
  const result = await request;
  check(Boolean(result.error), label);
  return result.error;
}

async function createIdentity(label, role) {
  const email = `jobs-assignment-${runId}-${label}@example.com`;
  const created = await ok(`create ${label} identity`, service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  }));
  const id = created.user?.id;
  check(Boolean(id), `${label} identity has id`);
  userIds.push(id);
  await ok(`configure ${label} profile`, service.from("profiles").update({
    role,
    is_active: true,
    full_name: `Assignment ${label}`,
  }).eq("id", id));
  const client = createClient(url, anonKey, options);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function cleanup() {
  const errors = [];
  if (jobIds.length) {
    const result = await service.from("jobs").delete().in("id", jobIds);
    if (result.error) errors.push("jobs");
  }
  if (crewIds.length) {
    const result = await service.from("crews").delete().in("id", crewIds);
    if (result.error) errors.push("crews");
  }
  for (const id of [...userIds].reverse()) {
    const result = await service.auth.admin.deleteUser(id);
    if (result.error) errors.push("identity");
  }
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`Cleanup failed [${[...new Set(errors)].join(",")}]`);
}

async function assignmentRows(client, ids) {
  return ok("read assignment rows", client.from("job_assignments")
    .select("job_id, assignee_type, technician_id, crew_id, assigned_by, active, is_primary")
    .in("job_id", ids).order("assigned_at", { ascending: true }));
}

async function main() {
  const admin = await createIdentity("admin", "admin");
  const supervisor = await createIdentity("supervisor", "supervisor");
  const technician = await createIdentity("technician", "tecnico");
  const crewLead = await createIdentity("crew-lead", "tecnico");

  const createdJobs = await ok("office creates three jobs", admin.client.from("jobs").insert([
    { title: `RPC individual ${runId}` },
    { title: `RPC bulk A ${runId}` },
    { title: `RPC bulk B ${runId}` },
  ]).select("id"));
  check(createdJobs.length === 3, "three jobs created");
  jobIds.push(...createdJobs.map(({ id }) => id));
  const [individualJob, bulkJobA, bulkJobB] = jobIds;

  const crew = await ok("office creates crew", admin.client.from("crews").insert({
    name: `RPC crew ${runId}`,
    lead_technician_id: crewLead.id,
  }).select("id").single());
  crewIds.push(crew.id);

  const individualResult = await ok("supervisor assigns one job", supervisor.client.rpc("assign_jobs_atomic", {
    job_ids: [individualJob],
    new_assignee_type: "technician",
    new_assignee_id: technician.id,
  }));
  check(individualResult.length === 1, "individual RPC returns one row");
  check(individualResult[0].technician_id === technician.id && individualResult[0].assigned_by === supervisor.id,
    "individual assignment records technician and actor");

  const initialRows = await assignmentRows(admin.client, [individualJob]);
  check(initialRows.length === 1 && initialRows[0].active && initialRows[0].is_primary,
    "individual assignment is active primary");
  const initialHistory = await ok("read individual history", admin.client.from("job_status_history")
    .select("changed_by, notes").eq("job_id", individualJob));
  check(initialHistory.length === 1 && initialHistory[0].changed_by === supervisor.id
    && initialHistory[0].notes === "Assignment updated", "individual assignment history records actor");

  const reassigned = await ok("admin reassigns job to crew", admin.client.rpc("assign_jobs_atomic", {
    job_ids: [individualJob],
    new_assignee_type: "crew",
    new_assignee_id: crew.id,
  }));
  check(reassigned.length === 1 && reassigned[0].crew_id === crew.id && reassigned[0].assigned_by === admin.id,
    "crew reassignment returns the new row and actor");
  const reassignmentRows = await assignmentRows(admin.client, [individualJob]);
  check(reassignmentRows.length === 2, "reassignment preserves both rows");
  check(!reassignmentRows[0].active && !reassignmentRows[0].is_primary,
    "previous primary assignment is inactive");
  check(reassignmentRows[1].active && reassignmentRows[1].is_primary && reassignmentRows[1].crew_id === crew.id,
    "new crew assignment is active primary");
  check(reassignmentRows.filter((row) => row.active && row.is_primary).length === 1,
    "reassignment leaves exactly one active primary");
  const reassignmentHistory = await ok("read reassignment history", admin.client.from("job_status_history")
    .select("changed_by, notes").eq("job_id", individualJob));
  check(reassignmentHistory.length === 2 && reassignmentHistory.some((entry) => entry.changed_by === admin.id),
    "reassignment appends history");

  const bulkResult = await ok("admin assigns two jobs in bulk", admin.client.rpc("assign_jobs_atomic", {
    job_ids: [bulkJobA, bulkJobB],
    new_assignee_type: "technician",
    new_assignee_id: technician.id,
  }));
  check(bulkResult.length === 2, "bulk RPC returns one row per job");
  check(bulkResult.every((row) => row.technician_id === technician.id && row.assigned_by === admin.id),
    "bulk assignments record technician and actor");
  const bulkRows = await assignmentRows(admin.client, [bulkJobA, bulkJobB]);
  check(bulkRows.length === 2 && bulkRows.every((row) => row.active && row.is_primary),
    "bulk jobs each have an active primary");
  const bulkHistory = await ok("read bulk history", admin.client.from("job_status_history")
    .select("job_id, changed_by, notes").in("job_id", [bulkJobA, bulkJobB]));
  check(bulkHistory.length === 2 && bulkHistory.every((entry) => entry.changed_by === admin.id
    && entry.notes === "Assignment updated"), "bulk assignment appends one history row per job");

  await rejected("technician cannot invoke assignment RPC", technician.client.rpc("assign_jobs_atomic", {
    job_ids: [bulkJobA],
    new_assignee_type: "crew",
    new_assignee_id: crew.id,
  }));
  const afterDenial = await assignmentRows(admin.client, [bulkJobA]);
  check(afterDenial.length === 1 && afterDenial[0].technician_id === technician.id
    && afterDenial[0].active && afterDenial[0].is_primary, "technician denial leaves assignment unchanged");

  await rejected("invalid job makes batch fail", supervisor.client.rpc("assign_jobs_atomic", {
    job_ids: [bulkJobA, randomUUID()],
    new_assignee_type: "crew",
    new_assignee_id: crew.id,
  }));
  const afterInvalidBatch = await assignmentRows(admin.client, [bulkJobA]);
  check(afterInvalidBatch.length === 1 && afterInvalidBatch[0].technician_id === technician.id
    && afterInvalidBatch[0].active && afterInvalidBatch[0].is_primary,
  "invalid batch rolls back without changing the valid job");

  await rejected("unique active primary constraint rejects duplicate", admin.client.from("job_assignments").insert({
    job_id: bulkJobB,
    assignee_type: "crew",
    crew_id: crew.id,
    assigned_by: admin.id,
  }));
  const afterDuplicate = await assignmentRows(admin.client, [bulkJobB]);
  check(afterDuplicate.length === 1 && afterDuplicate[0].active && afterDuplicate[0].is_primary,
    "duplicate primary rejection preserves coherent assignment");

  assert.equal(jobIds.length, 3);
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
  console.error(`[jobs-assignment-rpc] FAIL ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`[jobs-assignment-rpc] PASS checks=${checks} cleanup=${cleanupPassed ? "passed" : "failed"} users=${userIds.length} jobs=${jobIds.length} crews=${crewIds.length}`);
}
