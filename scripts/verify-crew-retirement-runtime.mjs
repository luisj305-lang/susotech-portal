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
const runtimeHost = new URL(url).hostname;
if (!["127.0.0.1", "localhost"].includes(runtimeHost)) {
  throw new Error("Crew retirement runtime is local-only; refusing to mutate a hosted Supabase project");
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const suffix = randomBytes(6).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const userIds = [];
let crewId;
let jobId;
let checks = 0;

function check(condition, message, error) {
  if (!condition) throw new Error(`${message} [${error?.code ?? error?.message ?? "assertion"}]`);
  checks += 1;
}

async function identity(label, role) {
  const email = `crew-retirement-${suffix}-${label}@example.com`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  check(!created.error && created.data.user?.id, `create ${label}`, created.error);
  const id = created.data.user.id;
  userIds.push(id);
  const configured = await service.from("profiles").update({ role, is_active: true, full_name: label }).eq("id", id);
  check(!configured.error, `configure ${label}`, configured.error);
  const client = createClient(url, anonKey, options);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  check(!signedIn.error, `sign in ${label}`, signedIn.error);
  return { id, client };
}

async function main() {
  const admin = await identity("Admin", "admin");
  const worker = await identity("Worker", "tecnico");

  const fixtureCrew = await service.from("crews").insert({ name: `Legacy crew ${suffix}`, lead_technician_id: worker.id }).select("id").single();
  check(!fixtureCrew.error, "service creates isolated legacy crew fixture", fixtureCrew.error);
  crewId = fixtureCrew.data.id;

  const visible = await admin.client.from("crews").select("id,name").eq("id", crewId).single();
  check(!visible.error && visible.data.id === crewId, "office historical crew SELECT remains available", visible.error);

  const createDenied = await admin.client.from("crews").insert({ name: `Forbidden ${suffix}`, lead_technician_id: worker.id }).select("id");
  check(Boolean(createDenied.error) || createDenied.data?.length === 0, "Admin cannot create a new crew", createDenied.error);
  const updateDenied = await admin.client.from("crews").update({ name: "Forbidden update" }).eq("id", crewId).select("id");
  check(Boolean(updateDenied.error) || updateDenied.data?.length === 0, "Admin cannot update a crew", updateDenied.error);
  const memberDenied = await admin.client.from("crew_members").insert({ crew_id: crewId, technician_id: worker.id }).select("crew_id");
  check(Boolean(memberDenied.error) || memberDenied.data?.length === 0, "Admin cannot add crew members", memberDenied.error);

  const fixtureJob = await admin.client.from("jobs").insert({ title: `Retirement ${suffix}` }).select("id").single();
  check(!fixtureJob.error, "Admin creates assignment fixture job", fixtureJob.error);
  jobId = fixtureJob.data.id;

  const crewRpc = await admin.client.rpc("assign_jobs_atomic", {
    job_ids: [jobId], new_assignee_type: "crew", new_assignee_id: crewId,
  });
  check(Boolean(crewRpc.error) && /retired/i.test(crewRpc.error.message), "assignment RPC rejects crew", crewRpc.error);

  const directCrew = await admin.client.from("job_assignments").insert({
    job_id: jobId, assignee_type: "crew", crew_id: crewId, is_primary: true,
  }).select("id");
  check(Boolean(directCrew.error) && /retired/i.test(directCrew.error.message), "assignment trigger rejects direct crew insert", directCrew.error);

  const individualRpc = await admin.client.rpc("assign_jobs_atomic", {
    job_ids: [jobId], new_assignee_type: "technician", new_assignee_id: worker.id,
  });
  check(!individualRpc.error && individualRpc.data?.length === 1, "individual operational assignment remains available", individualRpc.error);
}

async function cleanup() {
  const failures = [];
  if (jobId && (await service.from("jobs").delete().eq("id", jobId)).error) failures.push("job");
  if (crewId && (await service.from("crews").delete().eq("id", crewId)).error) failures.push("crew");
  for (const id of [...userIds].reverse()) if ((await service.auth.admin.deleteUser(id)).error) failures.push("user");
  if (failures.length) throw new Error(`cleanup failed: ${failures.join(",")}`);
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally { try { await cleanup(); } catch (error) { failure ??= error; } }

if (failure) {
  console.error(`[crew-retirement-runtime] FAIL ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`[crew-retirement-runtime] PASS checks=${checks} cleanup=passed`);
}
