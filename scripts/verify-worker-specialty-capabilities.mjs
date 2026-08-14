import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if (/^(['"]).*\1$/u.test(value)) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(new URL("../.env.local", import.meta.url));
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase environment variables");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const userIds = [];
const jobIds = [];
const fuelPaths = [];
let checks = 0;

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
  const hidden = result.data === null || (Array.isArray(result.data) && result.data.length === 0);
  check(Boolean(result.error) || hidden, label);
}
async function identity(label, role) {
  const email = `specialty-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  userIds.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: true, full_name: `Specialty ${label}` }).eq("id", id));
  const client = createClient(url, anonKey, options);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}
async function cleanup() {
  if (jobIds.length) await service.from("jobs").delete().in("id", jobIds);
  if (userIds.length) await service.from("technician_shifts").delete().in("technician_id", userIds);
  if (fuelPaths.length) await service.storage.from("technician-shift-fuel").remove(fuelPaths);
  for (const id of [...userIds].reverse()) await service.auth.admin.deleteUser(id);
}

async function main() {
  const admin = await identity("admin", "admin");
  const supervisor = await identity("supervisor", "supervisor");
  const technician = await identity("technician", "tecnico");
  const splicer = await identity("splicer", "tecnico");
  const liner = await identity("liner", "tecnico");
  const helper = await identity("helper", "tecnico");

  const defaultProfile = await ok("new field worker defaults to tecnico", admin.client.from("profiles")
    .select("worker_specialty").eq("id", technician.id).single());
  check(defaultProfile.worker_specialty === "tecnico", "technician-only default is applied");

  for (const [worker, specialty] of [[technician, "tecnico"], [splicer, "splicer"], [liner, "liner"], [helper, "ayudante"]]) {
    await ok(`admin sets ${specialty}`, admin.client.rpc("set_worker_specialty", {
      p_profile_id: worker.id, p_worker_specialty: specialty,
    }));
  }
  await denied("supervisor cannot change specialty", supervisor.client.rpc("set_worker_specialty", {
    p_profile_id: helper.id, p_worker_specialty: "tecnico",
  }));
  await denied("field worker cannot change specialty", technician.client.rpc("set_worker_specialty", {
    p_profile_id: helper.id, p_worker_specialty: "tecnico",
  }));

  const officeRows = await ok("supervisor sees worker specialties", supervisor.client.rpc("list_profiles_for_office"));
  check(officeRows.some((row) => row.id === helper.id && row.worker_specialty === "ayudante"), "office directory exposes helper specialty");

  for (const [worker, specialty] of [[technician, "tecnico"], [splicer, "splicer"], [liner, "liner"]]) {
    await ok(`${specialty} starts shift`, worker.client.rpc("start_technician_shift", {
      p_no_fuel_today: true, p_fuel_amount: 0, p_fuel_photo_path: null,
    }));
    const job = await ok(`admin creates ${specialty} job`, admin.client.from("jobs")
      .insert({ title: `Specialty ${specialty} ${runId}` }).select("id").single());
    jobIds.push(job.id);
    await ok(`${specialty} can be primary`, admin.client.rpc("assign_jobs_atomic", {
      job_ids: [job.id], new_assignee_type: "technician", new_assignee_id: worker.id,
    }));
  }

  await denied("assigned technician cannot become helper", admin.client.rpc("set_worker_specialty", {
    p_profile_id: technician.id, p_worker_specialty: "ayudante",
  }));
  await denied("assigned splicer cannot be deactivated", admin.client.from("profiles")
    .update({ is_active: false }).eq("id", splicer.id).select("id"));
  await denied("assigned liner cannot become office staff", admin.client.from("profiles")
    .update({ role: "supervisor" }).eq("id", liner.id).select("id"));
  const preservedEligibility = await ok("failed transitions preserve operational profiles", admin.client.from("profiles")
    .select("id,role,is_active,worker_specialty").in("id", [technician.id, splicer.id, liner.id]));
  check(preservedEligibility.length === 3
    && preservedEligibility.every((row) => row.role === "tecnico" && row.is_active)
    && preservedEligibility.some((row) => row.id === technician.id && row.worker_specialty === "tecnico")
    && preservedEligibility.some((row) => row.id === splicer.id && row.worker_specialty === "splicer")
    && preservedEligibility.some((row) => row.id === liner.id && row.worker_specialty === "liner"),
  "invalid eligibility transitions are atomic");
  const preservedAssignments = await ok("failed transitions preserve primary assignments", admin.client
    .from("job_assignments").select("technician_id,active,is_primary")
    .in("technician_id", [technician.id, splicer.id, liner.id]));
  check(preservedAssignments.length === 3
    && preservedAssignments.every((row) => row.active && row.is_primary),
  "active primary assignments remain valid after rejected transitions");

  const helperFuelPath = `${helper.id}/${randomUUID()}.jpg`;
  fuelPaths.push(helperFuelPath);
  await ok("helper uploads fuel photo", helper.client.storage.from("technician-shift-fuel")
    .upload(helperFuelPath, new Uint8Array([255, 216, 255, 217]), { contentType: "image/jpeg" }));
  const helperShift = await ok("helper starts shift with fuel and photo", helper.client.rpc("start_technician_shift", {
    p_no_fuel_today: false, p_fuel_amount: 42.35, p_fuel_photo_path: helperFuelPath,
  }));
  check(helperShift?.[0]?.fuel_photo_path === helperFuelPath
    && Number(helperShift?.[0]?.fuel_amount) === 42.35
    && helperShift?.[0]?.no_fuel_today === false,
  "helper fuel amount and photo are persisted");
  const helperJob = await ok("admin creates helper assignment fixture", admin.client.from("jobs")
    .insert({ title: `Helper denied ${runId}` }).select("id").single());
  jobIds.push(helperJob.id);
  await denied("helper cannot be primary assignee", admin.client.rpc("assign_jobs_atomic", {
    job_ids: [helperJob.id], new_assignee_type: "technician", new_assignee_id: helper.id,
  }));

  const operationalJob = jobIds[0];
  await denied("helper cannot mutate job", helper.client.from("jobs")
    .update({ comments: "forbidden" }).eq("id", operationalJob).select("id"));
  await denied("helper cannot initialize PDF draft", helper.client.rpc("initialize_job_pdf_draft_v2", {
    p_job_id: operationalJob, p_source_document_ids: [], p_page_count: 1,
  }));
  await denied("helper cannot upload job evidence", helper.client.storage.from("job-evidence")
    .upload(`${operationalJob}/helper-${runId}.jpg`, new Uint8Array([255, 216, 255, 217]), { contentType: "image/jpeg" }));

  const helperCapabilities = await ok("helper capabilities resolve", helper.client.rpc("is_read_only_helper", { check_user_id: helper.id }));
  check(helperCapabilities === true, "helper capability is recognized");
  const helperMutation = await ok("helper mutation capability resolves", helper.client.rpc("can_mutate_job", {
    check_job_id: operationalJob, check_user_id: helper.id,
  }));
  check(helperMutation === false, "helper mutation capability is always false");
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally { try { await cleanup(); } catch (error) { failure ??= error; } }
if (failure) {
  console.error(`[worker-specialty-capabilities] FAIL ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`[worker-specialty-capabilities] PASS checks=${checks}`);
}
