import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { UploadFeedback } from "../src/components/jobs/upload-feedback.ts";

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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Missing required Supabase server environment variables");

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options); // Fixture setup/cleanup only.
const runId = randomBytes(8).toString("hex");
const password = `${randomBytes(18).toString("base64url")}Aa1!`;
const users = [];
const jobs = [];
const crews = [];
const objects = [];
let checks = 0;
let cleanupPassed = false;
let serverStopped = false;
let nextProcess;

function check(condition, label, error) {
  if (!condition) throw new Error(`${label} [${error?.code ?? error?.status ?? "assertion"}]`);
  checks += 1;
}

async function ok(label, request) {
  const result = await request;
  check(!result.error, label, result.error);
  return result.data;
}

async function identity(label, role) {
  const email = `jobs-routes-${runId}-${label}@example.com`;
  const created = await ok(`create ${label}`, service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = created.user?.id;
  check(Boolean(id), `${label} has id`);
  users.push(id);
  await ok(`configure ${label}`, service.from("profiles").update({ role, is_active: true, full_name: `Routes ${label}` }).eq("id", id));
  const jar = new Map();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  await ok(`sign in ${label}`, client.auth.signInWithPassword({ email, password }));
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  check(cookie.length > 0, `${label} SSR cookie created`);
  return { id, client, cookie };
}

async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function startNext() {
  const externalBase = process.env.JOBS_ROUTES_BASE_URL?.replace(/\/$/u, "");
  if (externalBase) {
    const response = await fetch(`${externalBase}/login`);
    check(response.ok, "deployed Next server ready");
    serverStopped = true;
    return externalBase;
  }
  const port = await freePort();
  nextProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (nextProcess.exitCode !== null) throw new Error("Next server exited before readiness");
    try { const response = await fetch(`${base}/login`); if (response.ok) { check(true, "compiled Next server ready"); return base; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Next server readiness timeout");
}

async function stopNext() {
  if (!nextProcess || nextProcess.exitCode !== null) { serverStopped = true; return; }
  nextProcess.kill();
  await Promise.race([once(nextProcess, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (nextProcess.exitCode === null) nextProcess.kill("SIGKILL");
  serverStopped = nextProcess.exitCode !== null || nextProcess.killed;
  if (!serverStopped) throw new Error("Next server cleanup failed");
}

async function cleanup() {
  const errors = [];
  if (objects.length && (await service.storage.from("project-files").remove(objects)).error) errors.push("objects");
  if (jobs.length && (await service.from("jobs").delete().in("id", jobs)).error) errors.push("jobs");
  if (crews.length && (await service.from("crews").delete().in("id", crews)).error) errors.push("crews");
  for (const id of [...users].reverse()) if ((await service.auth.admin.deleteUser(id)).error) errors.push("users");
  cleanupPassed = errors.length === 0;
  if (!cleanupPassed) throw new Error(`Fixture cleanup failed [${[...new Set(errors)].join(",")}]`);
}

async function page(base, path, cookie) {
  return fetch(`${base}${path}`, { headers: { cookie, accept: "text/html,application/xhtml+xml" }, redirect: "manual" });
}

async function html(base, path, cookie) {
  const response = await page(base, path, cookie);
  const body = await response.text();
  return { response, body };
}

async function main() {
  const admin = await identity("admin", "admin");
  const supervisor = await identity("supervisor", "supervisor");
  const technician = await identity("technician", "tecnico");
  const empty = await identity("empty", "tecnico");
  const directTitle = `Direct route ${runId}`;
  const crewTitle = `Crew route ${runId}`;
  const foreignTitle = `Foreign route ${runId}`;
  const created = await ok("office creates route jobs", supervisor.client.from("jobs").insert([
    { title: directTitle, description: "Direct instructions" },
    { title: crewTitle, description: "Crew instructions" },
    { title: foreignTitle, description: "Foreign instructions" },
  ]).select("id,title"));
  jobs.push(...created.map((row) => row.id));
  const directJob = created.find((row) => row.title === directTitle).id;
  const crewJob = created.find((row) => row.title === crewTitle).id;
  const foreignJob = created.find((row) => row.title === foreignTitle).id;
  const crew = await ok("admin creates route crew", admin.client.from("crews").insert({
    name: `Route crew ${runId}`, lead_technician_id: technician.id,
  }).select("id").single());
  crews.push(crew.id);
  await ok("office assigns direct job", supervisor.client.rpc("assign_jobs_atomic", {
    job_ids: [directJob], new_assignee_type: "technician", new_assignee_id: technician.id,
  }));
  await ok("office assigns crew job", supervisor.client.rpc("assign_jobs_atomic", {
    job_ids: [crewJob], new_assignee_type: "crew", new_assignee_id: crew.id,
  }));
  const importedTitle = `Plano 42 route ${runId}`;
  const imported = await ok("create search fixture", supervisor.client.from("jobs").insert({ title: importedTitle }).select("id").single());
  const importedId = imported.id;
  jobs.push(importedId);

  const base = await startNext();
  const adminDashboard = await html(base, "/dashboard", admin.cookie);
  check(adminDashboard.response.status === 200 && adminDashboard.body.includes('href="/trabajos/nuevo"') && adminDashboard.body.includes("+ Nuevo trabajo"), "admin dashboard renders native new-job link");
  check(adminDashboard.body.includes('href="/trabajos"') && adminDashboard.body.includes("Ver trabajos"), "admin dashboard renders jobs-list link");
  const supervisorDashboard = await html(base, "/dashboard", supervisor.cookie);
  check(supervisorDashboard.response.status === 200 && supervisorDashboard.body.includes('href="/trabajos/nuevo"'), "supervisor dashboard renders native new-job link");
  const technicianDashboard = await html(base, "/dashboard", technician.cookie);
  check(technicianDashboard.response.status === 200 && !technicianDashboard.body.includes('href="/trabajos/nuevo"') && technicianDashboard.body.includes('href="/trabajos"'), "technician dashboard hides creation and keeps jobs-list link");
  check(!adminDashboard.body.includes("Nuevo Proyecto") && !adminDashboard.body.includes("/proyectos"), "dashboard removes legacy projects domain");
  const usersPage = await html(base, "/usuarios", admin.cookie);
  check(usersPage.response.status === 200 && usersPage.body.includes("Administración de usuarios"), "admin renders users route");
  const deniedUsers = await html(base, "/usuarios", technician.cookie);
  const usersRedirect = deniedUsers.response.headers.get("location")?.endsWith("/acceso-denegado") || deniedUsers.body.includes("/acceso-denegado");
  check(Boolean(usersRedirect) && !deniedUsers.body.includes("Administración de usuarios"), "technician receives access-denied navigation from users route");
  const newJob = await html(base, "/trabajos/nuevo", supervisor.cookie);
  check(newJob.response.status === 200 && newJob.body.includes("Nuevo trabajo"), "supervisor requireRole route renders");
  const deniedImport = await html(base, "/trabajos/importar", technician.cookie);
  const importRedirect = deniedImport.response.headers.get("location")?.endsWith("/acceso-denegado") || deniedImport.body.includes("/acceso-denegado");
  check(Boolean(importRedirect) && !deniedImport.body.includes("Crear trabajos desde PDF"), "technician receives access-denied navigation from office import route");
  const supervisorList = await html(base, "/trabajos", supervisor.cookie);
  check(supervisorList.response.status === 200 && supervisorList.body.includes("Operaciones") && supervisorList.body.includes("Importar trabajos"), "supervisor renders allowed office view");
  const searched = await html(base, `/trabajos?q=${encodeURIComponent(importedTitle)}`, supervisor.cookie);
  check(searched.response.status === 200 && searched.body.includes(importedTitle), "office route renders filename-style search match");
  check(!searched.body.includes(directTitle) && !searched.body.includes(crewTitle) && !searched.body.includes(foreignTitle), "office search omits unrelated titles");
  const field = await html(base, "/trabajos", technician.cookie);
  check(field.response.status === 200 && field.body.includes("Mis trabajos") && !field.body.includes("Importar trabajos"), "technician renders field view without office controls");
  check(field.body.includes(directTitle) && field.body.includes(crewTitle) && !field.body.includes(foreignTitle), "mixed direct and crew list excludes foreign job");
  const emptyList = await html(base, "/trabajos", empty.cookie);
  check(emptyList.response.status === 200 && emptyList.body.includes("No tienes trabajos asignados"), "empty technician state renders");
  const ownDetail = await html(base, `/trabajos/${directJob}`, technician.cookie);
  check(ownDetail.response.status === 200 && ownDetail.body.includes(directTitle) && ownDetail.body.includes("Iniciar trabajo"), "assigned detail renders start control");
  check(ownDetail.body.includes("Código de producción") && ownDetail.body.includes("Evidencia fotográfica") && ownDetail.body.includes("Guardar incidencia"), "assigned detail renders operational controls");
  check(ownDetail.body.includes("<button") && ownDetail.body.includes("<input") && ownDetail.body.includes("<select"), "detail uses native keyboard-operable controls");
  const foreignDetail = await html(base, `/trabajos/${foreignJob}`, technician.cookie);
  const notFoundSignal = foreignDetail.response.status === 404 || foreignDetail.body.includes("This page could not be found") || foreignDetail.body.includes("NEXT_HTTP_ERROR_FALLBACK;404");
  check(notFoundSignal && !foreignDetail.body.includes(foreignTitle), "foreign detail renders not-found without protected data");

  const feedback = renderToStaticMarkup(createElement(UploadFeedback, {
    message: "No se pudo subir la foto.", pendingFile: "evidence.jpg",
  }));
  check(feedback.includes('role="status"') && feedback.includes("Archivo pendiente: evidence.jpg"), "recoverable error component retains pending file context");
  check(feedback.includes("Puedes reintentar sin seleccionarlo de nuevo"), "recoverable error component renders retry instruction");
}

let failure;
try { await main(); } catch (error) { failure = error; }
finally {
  try { await stopNext(); } catch (error) { failure ??= error; }
  try { await cleanup(); } catch (error) { failure ??= error; }
}

if (failure) {
  console.error(`[jobs-routes-runtime] FAIL ${failure.message} server=${serverStopped ? "stopped" : "running"} cleanup=${cleanupPassed ? "passed" : "failed"}`);
  process.exitCode = 1;
} else {
  console.log(`[jobs-routes-runtime] PASS checks=${checks} server=stopped cleanup=passed users=${users.length} jobs=${jobs.length} crews=${crews.length} objects=${objects.length}`);
}
