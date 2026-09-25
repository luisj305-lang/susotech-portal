import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// A disposable, in-memory PostgreSQL fixture, never a Supabase connection.
// Pass the installed PGlite entry file; the application gains no dependency.
if (!process.argv[2]) throw new Error("Pass a local @electric-sql/pglite/dist/index.js path");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const jobId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const photoId = "33333333-3333-4333-8333-333333333333";
const pdfPath = (digit) => `${jobId}/delivered/${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}.pdf`;
const original = pdfPath("4");
const trimmed = pdfPath("5");
const repeated = pdfPath("6");
const regenerated = pdfPath("7");
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
    create table public.profiles (id uuid primary key, role text, is_active boolean);
    create table public.jobs (
      id uuid primary key, main_status text, archived_at timestamptz,
      delivered_pdf_path text, delivered_pdf_source_photo_ids uuid[], delivered_pdf_source_document_ids uuid[],
      delivered_pdf_generated_at timestamptz, delivered_pdf_generated_by uuid,
      current_delivery_id uuid, updated_at timestamptz,
      incident text, comments text, invoice_number text, invoice_path text,
      submitted_at timestamptz, approved_at timestamptz, invoiced_at timestamptz, paid_at timestamptz,
      financial_total numeric, allocation_snapshot jsonb
    );
    create table storage.objects (bucket_id text, name text primary key, metadata jsonb, user_metadata jsonb);
    create function public.can_mutate_job(uuid) returns boolean language sql as $$ select false $$;
    grant usage on schema public, auth to authenticated, anon;
    insert into public.profiles values ('${actorId}', 'admin', true);
    insert into public.jobs(id, main_status, delivered_pdf_path, delivered_pdf_source_photo_ids,
      delivered_pdf_source_document_ids, current_delivery_id, financial_total, allocation_snapshot)
    values ('${jobId}', 'en_revision', '${original}', array['${photoId}']::uuid[], array['${jobId}']::uuid[],
      '${jobId}', 125.50, '{"technician":7500,"company":2500}');
  `);
  const helpers = await readFile(new URL("../supabase/migrations/20260810001000_jobs_module.sql", import.meta.url), "utf8");
  const officeFunction = helpers.match(/create or replace function public\.is_office_staff[\s\S]*?\$\$;/u)?.[0];
  assert.ok(officeFunction);
  await db.exec(officeFunction);
  await db.exec(await readFile(new URL("../supabase/migrations/20260828030000_job_coordinate_enrichment_trigger.sql", import.meta.url), "utf8"));
  await db.exec("create trigger validate_job_update before update on public.jobs for each row execute function public.validate_job_update();");
  await db.exec(await readFile(new URL("../supabase/migrations/20260914010000_remove_delivered_pdf_pages.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20260914020000_harden_delivered_pdf_page_removal.sql", import.meta.url), "utf8"));
  await db.query("select set_config('test.actor', $1, false)", [actorId]);
  const object = (name, metadata) => db.query("insert into storage.objects values ('project-files', $1, $2::jsonb, $3::jsonb) on conflict(name) do update set user_metadata=excluded.user_metadata", [
    name, JSON.stringify({ size: 1000, mimetype: "application/pdf" }),
    JSON.stringify({ generator: "susotech-portal", job_id: jobId, actor_id: actorId, ...metadata }),
  ]);
  await object(original, {});
  await object(trimmed, { operation: "page-removal", expected_path: original });
  const invoke = async (expected = original, next = trimmed, photos = [photoId]) => {
    await db.exec("set role authenticated");
    try { return await db.query("select public.remove_delivered_pdf_pages($1, $2, $3, $4::uuid[])", [jobId, expected, next, photos]); }
    finally { await db.exec("reset role"); }
  };
  const rejected = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
  await rejected(() => invoke(null), /Delivered PDF changed/u);
  await rejected(() => invoke(original, null), /path is invalid/u);
  await rejected(() => invoke(original, original), /path is invalid/u);
  await rejected(() => invoke(original, `${jobId}/original.pdf`), /path is invalid/u);
  await rejected(() => invoke(original, regenerated), /object is missing or invalid/u);
  await rejected(() => invoke(original, trimmed, []), /source snapshot changed/u);
  for (const role of ["tecnico", "unknown"]) {
    await db.query("update public.profiles set role=$1", [role]);
    await rejected(() => invoke(), /Office access required/u);
  }
  await db.exec("update public.profiles set role='admin', is_active=false");
  await rejected(() => invoke(), /Office access required/u);
  await db.exec("update public.profiles set is_active=true");
  await db.query("select set_config('test.actor', '', false)");
  await rejected(() => invoke(), /Office access required/u);
  await db.query("select set_config('test.actor', $1, false)", [actorId]);
  await db.exec("set role anon");
  await rejected(() => db.query("select public.remove_delivered_pdf_pages($1,$2,$3,$4::uuid[])", [jobId, original, trimmed, [photoId]]), /permission denied/u);
  await db.exec("reset role");
  // Bypass the workflow trigger only to arrange denied-status fixture states.
  for (const status of ["sin_asignar", "aprobado", "facturado", "pagado"]) {
    await db.exec("alter table public.jobs disable trigger validate_job_update");
    await db.query("update public.jobs set main_status=$1", [status]);
    await db.exec("alter table public.jobs enable trigger validate_job_update");
    await rejected(() => invoke(), /Job is not editable/u);
  }
  await db.exec("alter table public.jobs disable trigger validate_job_update; update public.jobs set main_status='en_revision', archived_at=now(); alter table public.jobs enable trigger validate_job_update;");
  await rejected(() => invoke(), /Job is not editable/u);
  await db.exec("update public.jobs set archived_at=null");
  await object(trimmed, { operation: "page-removal", expected_path: original, actor_id: jobId });
  await rejected(() => invoke(), /object is missing or invalid/u);
  await object(trimmed, { operation: "page-removal", expected_path: original });
  const protectedFields = "main_status, current_delivery_id, delivered_pdf_source_photo_ids, delivered_pdf_source_document_ids, financial_total, allocation_snapshot";
  const before = (await db.query(`select ${protectedFields} from public.jobs`)).rows;
  await invoke(); checks++;
  assert.deepEqual((await db.query(`select ${protectedFields} from public.jobs`)).rows, before); checks++;
  await rejected(() => invoke(), /Delivered PDF changed/u);
  await db.exec("update public.profiles set role='supervisor'");
  await object(repeated, { operation: "page-removal", expected_path: trimmed });
  await invoke(trimmed, repeated); checks++;
  assert.deepEqual((await db.query(`select ${protectedFields} from public.jobs`)).rows, before); checks++;

  // Exercise the real row trigger in both race orderings. PGlite is one session:
  // these prove stale-revision interleavings, not parallel connection scheduling.
  const replace = async () => {
    await db.exec("begin");
    try {
      await db.query("select set_config('app.delivered_pdf_confirmation', $1, true)", [actorId]);
      await db.query("update public.jobs set delivered_pdf_path=$1 where id=$2", [regenerated, jobId]);
      await db.exec("commit");
    } catch (error) { await db.exec("rollback"); throw error; }
  };
  await object(regenerated, { expected_path: original, replacement_confirmed: "true" });
  await rejected(replace, /Delivered PDF changed/u);
  await object(regenerated, { expected_path: repeated });
  await rejected(replace, /explicit replacement confirmation required/u);
  await object(regenerated, {});
  await rejected(replace, /Delivered PDF changed/u);
  await object(regenerated, { expected_path: repeated, replacement_confirmed: "true" });
  await replace(); checks++;
  await rejected(() => invoke(repeated, trimmed), /Delivered PDF changed/u);
  assert.equal((await db.query("select delivered_pdf_path from public.jobs")).rows[0].delivered_pdf_path, regenerated); checks++;
  console.log(JSON.stringify({ result: "PASS", checks, database: "disposable in-memory PGlite", realFunctions: ["is_office_staff", "validate_job_update", "remove_delivered_pdf_pages", "guard_trimmed_delivered_pdf_replacement"], concurrentSessions: false }));
} finally { await db.close(); }
