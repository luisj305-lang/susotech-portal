import assert from "node:assert/strict";
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
const url = process.env.WORK_SHIFT_TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.WORK_SHIFT_TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.WORK_SHIFT_TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing work-shift Supabase test environment");

const hostname = new URL(url).hostname;
const localHosts = new Set(["127.0.0.1", "localhost", "host.docker.internal", "supabase_kong_susotech-portal"]);
if (!localHosts.has(hostname) && process.env.WORK_SHIFT_TEST_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing non-local Supabase. Set WORK_SHIFT_TEST_ALLOW_REMOTE=1 only for an isolated disposable test project.");
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const runId = randomBytes(7).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const exactShiftMessage = "Tu jornada de trabajo terminó. Inicia una nueva jornada para continuar.";
const users = [];
const jobs = [];
const crews = [];
const objects = { "project-files": [], "job-evidence": [], "technician-shift-fuel": [] };
let checks = 0;
let cleanupPassed = false;

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=", "base64");
const minimalPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

function check(condition, label, error) {
  assert.ok(condition, `${label}${error ? ` [${error.code ?? error.message}]` : ""}`);
  checks += 1;
}

async function ok(label, promise) {
  const result = await promise;
  check(!result.error, label, result.error);
  return result.data;
}

async function shiftDenied(label, promise) {
  const result = await promise;
  check(Boolean(result.error), label);
  check(result.error.message.includes(exactShiftMessage), `${label} returns exact shift message`, result.error);
  return result.error;
}

async function hidden(label, promise) {
  const result = await promise;
  check(!result.error, label, result.error);
  check(Array.isArray(result.data) && result.data.length === 0, `${label} returns no rows`);
}

async function storageDenied(label, promise) {
  const result = await promise;
  check(Boolean(result.error), label);
}

async function identity(label, role) {
  const email = `work-shift-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  users.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({
    role, is_active: true, full_name: `Shift ${label}`,
  }).eq("id", id));
  const client = createClient(url, anonKey, options);
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  return { id, client };
}

async function upload(bucket, path, bytes, contentType, client = service, metadata) {
  await ok(`upload ${bucket}/${path}`, client.storage.from(bucket).upload(path, bytes, {
    contentType, upsert: false, metadata,
  }));
  objects[bucket].push(path);
}

async function uploadFuelPhotoSigned(identity, path) {
  const prepared = await ok(
    "prepare signed fuel-photo upload",
    identity.client.storage.from("technician-shift-fuel").createSignedUploadUrl(path),
  );
  await ok(
    "upload signed fuel photo",
    identity.client.storage.from("technician-shift-fuel").uploadToSignedUrl(
      path,
      prepared.token,
      tinyPng,
      { contentType: "image/png" },
    ),
  );
  objects["technician-shift-fuel"].push(path);
}

async function startShift(identity, input, label) {
  const rows = await ok(label, identity.client.rpc("start_technician_shift", {
    p_no_fuel_today: input.noFuel,
    p_fuel_amount: input.amount,
    p_fuel_photo_path: input.photoPath ?? null,
  }));
  check(rows?.length === 1, `${label} returns one shift`);
  const row = rows[0];
  check(
    new Date(row.active_until).getTime() - new Date(row.started_at).getTime() === 10 * 60 * 60 * 1000,
    `${label} lasts exactly ten hours`,
  );
  return row;
}

async function createJob(admin, title, assignee) {
  const id = randomUUID();
  const originalPath = `${id}/original.pdf`;
  await ok(`create ${title}`, admin.client.from("jobs").insert({
    id, title, main_status: "en_progreso", project_pdf_url: originalPath,
  }));
  jobs.push(id);
  await upload("project-files", originalPath, minimalPdf, "application/pdf");
  await ok(`assign ${title}`, admin.client.rpc("assign_jobs_atomic", {
    job_ids: [id],
    new_assignee_type: assignee.type,
    new_assignee_id: assignee.id,
  }));
  return { id, originalPath };
}

async function seedRelated(job, actorId) {
  const photoId = randomUUID();
  const photoPath = `${job.id}/${randomUUID()}.png`;
  await upload("job-evidence", photoPath, tinyPng, "image/png");
  await ok("seed job photo", service.from("job_photos").insert({
    id: photoId, job_id: job.id, storage_path: photoPath,
    photo_type: "evidence", uploaded_by: actorId,
  }));
  await ok("seed job history", service.from("job_status_history").insert({
    job_id: job.id, previous_status: "asignado", new_status: "en_progreso",
    changed_by: actorId, notes: "shift fixture",
  }));
  await ok("seed production", service.from("job_production_codes").insert({
    job_id: job.id, code: "SHIFT", quantity: 1, added_by: actorId,
  }));
  await ok("seed PDF draft", service.from("job_pdf_drafts").insert({
    job_id: job.id, source_page_count: 1, updated_by: actorId,
  }));
  const documentId = randomUUID();
  await ok("seed job document", service.from("job_documents").insert({
    id: documentId,
    job_id: job.id,
    display_name: "original.pdf",
    original_filename: "original.pdf",
    storage_path: job.originalPath,
    mime_type: "application/pdf",
    size_bytes: minimalPdf.length,
    status: "active",
    uploaded_by: actorId,
    confirmed_at: new Date().toISOString(),
    document_type: "original",
    position: 0,
    verification_status: "metadata_verified",
  }));
  const deliveredPath = `${job.id}/delivered/${randomUUID()}.pdf`;
  await upload("project-files", deliveredPath, minimalPdf, "application/pdf", service, {
    generator: "susotech-portal", job_id: job.id, source_photo_ids: photoId,
  });
  return { photoId, photoPath, deliveredPath, documentId };
}

async function assertBlockedBoundaries(identity, job, fixture, assignmentType, label) {
  const before = {
    job: await ok(`${label}: snapshot job before denied writes`, service.from("jobs")
      .select("main_status,comments,delivered_pdf_path").eq("id", job.id).single()),
    photos: await ok(`${label}: snapshot photos before denied writes`, service.from("job_photos")
      .select("id").eq("job_id", job.id).order("id")),
    production: await ok(`${label}: snapshot production before denied writes`, service.from("job_production_codes")
      .select("id").eq("job_id", job.id).order("id")),
    draft: await ok(`${label}: snapshot draft before denied writes`, service.from("job_pdf_drafts")
      .select("version,placements").eq("job_id", job.id).single()),
  };
  await shiftDenied(`${label}: job read`, identity.client.from("jobs").select("id").eq("id", job.id));
  await shiftDenied(`${label}: can_access_job`, identity.client.rpc("can_access_job", {
    check_job_id: job.id, check_user_id: identity.id,
  }));
  await hidden(`${label}: ${assignmentType} assignment hidden`, identity.client.from("job_assignments")
    .select("id").eq("job_id", job.id));
  await shiftDenied(`${label}: evidence rows`, identity.client.from("job_photos").select("id").eq("job_id", job.id));
  await shiftDenied(`${label}: document rows`, identity.client.from("job_documents").select("id").eq("job_id", job.id));
  await shiftDenied(`${label}: history rows`, identity.client.from("job_status_history").select("id").eq("job_id", job.id));
  await shiftDenied(`${label}: production rows`, identity.client.from("job_production_codes").select("id").eq("job_id", job.id));
  await shiftDenied(`${label}: PDF draft rows`, identity.client.from("job_pdf_drafts").select("job_id").eq("job_id", job.id));
  await storageDenied(`${label}: original PDF Storage`, identity.client.storage.from("project-files").download(job.originalPath));
  await storageDenied(`${label}: evidence Storage`, identity.client.storage.from("job-evidence").download(fixture.photoPath));
  await shiftDenied(`${label}: job mutation`, identity.client.from("jobs")
    .update({ comments: "must fail without shift" }).eq("id", job.id).select("id"));
  await shiftDenied(`${label}: evidence database mutation`, identity.client.from("job_photos").insert({
    job_id: job.id,
    storage_path: `${job.id}/${randomUUID()}.png`,
    photo_type: "evidence",
    uploaded_by: identity.id,
  }).select("id"));
  await shiftDenied(`${label}: production RPC`, identity.client.rpc("add_job_production", {
    p_job_id: job.id,
    p_catalog_id: randomUUID(),
    p_quantity: 1,
    p_production_date: null,
    p_notes: null,
  }));
  await shiftDenied(`${label}: draft initialization RPC`, identity.client.rpc("initialize_job_pdf_draft_v2", {
    p_job_id: job.id, p_source_document_ids: [fixture.documentId], p_page_count: 1,
  }));
  await shiftDenied(`${label}: draft save RPC`, identity.client.rpc("save_job_pdf_draft_v2", {
    p_job_id: job.id, p_expected_version: 0, p_placements: [],
  }));
  await shiftDenied(`${label}: delivered PDF RPC`, identity.client.rpc("confirm_delivered_job_pdf_complete", {
    p_job_id: job.id,
    p_storage_path: fixture.deliveredPath,
    p_source_photo_ids: [fixture.photoId],
    p_source_document_ids: [fixture.documentId],
    p_submit: true,
    p_expected_draft_version: 0,
    p_snapshot_hash: "0".repeat(64),
  }));
  const after = {
    job: await ok(`${label}: snapshot job after denied writes`, service.from("jobs")
      .select("main_status,comments,delivered_pdf_path").eq("id", job.id).single()),
    photos: await ok(`${label}: snapshot photos after denied writes`, service.from("job_photos")
      .select("id").eq("job_id", job.id).order("id")),
    production: await ok(`${label}: snapshot production after denied writes`, service.from("job_production_codes")
      .select("id").eq("job_id", job.id).order("id")),
    draft: await ok(`${label}: snapshot draft after denied writes`, service.from("job_pdf_drafts")
      .select("version,placements").eq("job_id", job.id).single()),
  };
  assert.deepEqual(after, before, `${label}: denied writes leave no database effects`);
  checks += 1;
}

async function assertOfficeBypass(identity, job, fixture, label) {
  const rows = await ok(`${label}: reads job without shift`, identity.client.from("jobs").select("id").eq("id", job.id));
  check(rows.length === 1, `${label}: job visible`);
  const assignments = await ok(`${label}: reads assignment without shift`, identity.client.from("job_assignments")
    .select("id").eq("job_id", job.id));
  check(assignments.length === 1, `${label}: assignment visible`);
  for (const table of ["job_photos", "job_documents", "job_status_history", "job_production_codes", "job_pdf_drafts"]) {
    const related = await ok(`${label}: reads ${table} without shift`, identity.client.from(table).select("*").eq("job_id", job.id));
    check(related.length >= 1, `${label}: ${table} visible`);
  }
  const access = await ok(`${label}: can_access_job bypass`, identity.client.rpc("can_access_job", {
    check_job_id: job.id, check_user_id: identity.id,
  }));
  check(access === true, `${label}: office job access returns true`);
  await ok(`${label}: job update bypass`, identity.client.from("jobs")
    .update({ comments: `${label} bypass` }).eq("id", job.id).select("id").single());
  const original = await identity.client.storage.from("project-files").download(job.originalPath);
  check(!original.error && Boolean(original.data), `${label}: original PDF Storage bypass`, original.error);
  const evidence = await identity.client.storage.from("job-evidence").download(fixture.photoPath);
  check(!evidence.error && Boolean(evidence.data), `${label}: evidence Storage bypass`, evidence.error);
}

async function cleanup() {
  const errors = [];
  for (const [bucket, paths] of Object.entries(objects)) {
    if (paths.length && (await service.storage.from(bucket).remove(paths)).error) errors.push(bucket);
  }
  if (jobs.length && (await service.from("jobs").delete().in("id", jobs)).error) errors.push("jobs");
  if (crews.length && (await service.from("crews").delete().in("id", crews)).error) errors.push("crews");
  if (users.length && (await service.from("technician_shifts").delete().in("technician_id", users)).error) errors.push("shifts");

  if (jobs.length) {
    for (const table of ["jobs", "job_photos", "job_documents", "job_status_history", "job_production_codes", "job_pdf_drafts"]) {
      const column = table === "jobs" ? "id" : "job_id";
      const residue = await service.from(table).select(column).in(column, jobs);
      if (residue.error || residue.data.length) errors.push(`${table}-residue`);
    }
  }
  if (users.length) {
    const residue = await service.from("technician_shifts").select("id").in("technician_id", users);
    if (residue.error || residue.data.length) errors.push("shift-residue");
  }
  for (const id of [...users].reverse()) if ((await service.auth.admin.deleteUser(id)).error) errors.push("users");
  if (users.length) {
    const profiles = await service.from("profiles").select("id").in("id", users);
    if (profiles.error || profiles.data.length) errors.push("profile-residue");
  }
  for (const [bucket, paths] of Object.entries(objects)) {
    for (const path of paths) if (!(await service.storage.from(bucket).download(path)).error) errors.push(`${bucket}-object-residue`);
  }
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`cleanup failed: ${[...new Set(errors)].join(", ")}`);
}

async function main() {
  await ok("shift enforcement migration is present", service.from("technician_shifts").select("id").limit(1));
  await ok("active-shift predicate is present", service.rpc("has_active_technician_shift", {
    check_user_id: randomUUID(),
  }));

  const admin = await identity("admin", "admin");
  const supervisor = await identity("supervisor", "supervisor");
  const noShift = await identity("no-shift", "tecnico");
  const expired = await identity("expired", "tecnico");
  const noFuel = await identity("no-fuel", "tecnico");
  const fuelNoPhoto = await identity("fuel-no-photo", "tecnico");
  const fuelWithPhoto = await identity("fuel-with-photo", "tecnico");

  const noFuelShift = await startShift(noFuel, { noFuel: true, amount: 0 }, "start explicit no-fuel shift");
  check(noFuelShift.no_fuel_today && Number(noFuelShift.fuel_amount) === 0, "no-fuel shift persists explicit zero");
  check(noFuelShift.fuel_photo_path === null, "no-fuel shift has no photo");
  const duplicate = await noFuel.client.rpc("start_technician_shift", {
    p_no_fuel_today: true, p_fuel_amount: 0, p_fuel_photo_path: null,
  });
  check(Boolean(duplicate.error) && duplicate.error.message.includes("An active shift already exists"), "duplicate active shift is rejected", duplicate.error);

  const missingAmount = await noShift.client.rpc("start_technician_shift", {
    p_no_fuel_today: false, p_fuel_amount: null, p_fuel_photo_path: null,
  });
  check(Boolean(missingAmount.error), "fuel amount is required");
  const zeroFuel = await noShift.client.rpc("start_technician_shift", {
    p_no_fuel_today: false, p_fuel_amount: 0, p_fuel_photo_path: null,
  });
  check(Boolean(zeroFuel.error), "fuel amount must be positive");
  const excessiveDecimals = await noShift.client.rpc("start_technician_shift", {
    p_no_fuel_today: false, p_fuel_amount: "1.001", p_fuel_photo_path: null,
  });
  check(Boolean(excessiveDecimals.error), "fuel amount rejects more than two decimals");
  const noFuelWithAmount = await noShift.client.rpc("start_technician_shift", {
    p_no_fuel_today: true, p_fuel_amount: "1.00", p_fuel_photo_path: null,
  });
  check(Boolean(noFuelWithAmount.error), "no-fuel choice rejects a non-zero amount");
  const invalidNoFuelPhoto = `${noShift.id}/${randomUUID()}.png`;
  await uploadFuelPhotoSigned(noShift, invalidNoFuelPhoto);
  const noFuelWithPhoto = await noShift.client.rpc("start_technician_shift", {
    p_no_fuel_today: true, p_fuel_amount: 0, p_fuel_photo_path: invalidNoFuelPhoto,
  });
  check(Boolean(noFuelWithPhoto.error), "no-fuel choice rejects a photo");

  const decimalShift = await startShift(
    fuelNoPhoto,
    { noFuel: false, amount: "18.37" },
    "start decimal-fuel shift without photo",
  );
  check(Number(decimalShift.fuel_amount) === 18.37 && !decimalShift.no_fuel_today, "decimal fuel amount persists exactly");
  check(decimalShift.fuel_photo_path === null, "fuel photo is optional");

  const fuelPhotoPath = `${fuelWithPhoto.id}/${randomUUID()}.png`;
  await uploadFuelPhotoSigned(fuelWithPhoto, fuelPhotoPath);
  const photoShift = await startShift(
    fuelWithPhoto,
    { noFuel: false, amount: "42.15", photoPath: fuelPhotoPath },
    "start decimal-fuel shift with photo",
  );
  check(Number(photoShift.fuel_amount) === 42.15 && photoShift.fuel_photo_path === fuelPhotoPath, "optional fuel photo persists as a private path");
  const bucket = await ok("read private fuel bucket", service.storage.getBucket("technician-shift-fuel"));
  check(bucket.public === false, "fuel bucket remains private");

  const expiredStart = new Date(Date.now() - 11 * 60 * 60 * 1000);
  const expiredEnd = new Date(expiredStart.getTime() + 10 * 60 * 60 * 1000);
  await ok("seed expired shift", service.from("technician_shifts").insert({
    technician_id: expired.id,
    started_at: expiredStart.toISOString(),
    active_until: expiredEnd.toISOString(),
    fuel_amount: 0,
    no_fuel_today: true,
    fuel_photo_path: null,
    created_by: expired.id,
  }));
  const activeExpired = await ok("expired technician has no active shift", expired.client.rpc("get_my_active_shift"));
  check(activeExpired.length === 0, "expired shift is inactive");
  const activeMissing = await ok("no-shift technician has no active shift", noShift.client.rpc("get_my_active_shift"));
  check(activeMissing.length === 0, "missing shift is inactive");
  const foreignShiftProbe = await ok("technician probes another shift predicate", noShift.client.rpc(
    "has_active_technician_shift",
    { check_user_id: noFuel.id },
  ));
  check(foreignShiftProbe === false, "technician cannot query another technician's active-shift state");
  const foreignJobProbe = await ok("technician probes job access as another actor", noShift.client.rpc(
    "can_access_job",
    { check_job_id: randomUUID(), check_user_id: admin.id },
  ));
  check(foreignJobProbe === false, "technician cannot impersonate office staff through can_access_job");
  const crew = await ok("create crew fixture", admin.client.from("crews").insert({
    name: `Shift crew ${runId}`, lead_technician_id: expired.id,
  }).select("id").single());
  crews.push(crew.id);
  await ok("add active technician to crew fixture", admin.client.from("crew_members").insert({
    crew_id: crew.id, technician_id: noFuel.id,
  }));
  const individualJob = await createJob(admin, `No shift individual ${runId}`, { type: "technician", id: noShift.id });
  const crewJob = await createJob(admin, `Expired crew ${runId}`, { type: "crew", id: crew.id });
  const individualFixture = await seedRelated(individualJob, noShift.id);
  const crewFixture = await seedRelated(crewJob, expired.id);

  await assertBlockedBoundaries(noShift, individualJob, individualFixture, "individual", "no shift");
  await assertBlockedBoundaries(expired, crewJob, crewFixture, "crew", "expired shift");
  await assertOfficeBypass(admin, individualJob, individualFixture, "admin");
  await assertOfficeBypass(supervisor, crewJob, crewFixture, "supervisor");

  const activeJobs = await ok("active technician reads assigned crew job", noFuel.client.from("jobs")
    .select("id").eq("id", crewJob.id));
  check(activeJobs.length === 1, "active shift permits normal crew job access");
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally { try { await cleanup(); } catch (error) { failure ??= error; } }

if (failure) {
  console.error(`[work-shifts-runtime] FAIL ${failure.message} cleanup=${cleanupPassed ? "passed" : "failed"}`);
  process.exitCode = 1;
} else {
  console.log(`[work-shifts-runtime] PASS checks=${checks} cleanup=passed`);
}
