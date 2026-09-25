import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { workListLoader, workListNodes, workListUiStubs } from "./work-list-test-harness.mjs";

// Supply an already-installed PGlite entry; this test never connects to a
// Supabase instance or any customer data.
if (!process.argv[2]) throw new Error("Pass a local @electric-sql/pglite/dist/index.js path");

const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const creator = id(1), helper = id(2), percentageHelper = id(3), outsider = id(4), lead = id(5), office = id(6);
const manual = { pending: id(101), approved: id(102), rejected: id(103), endExclusive: id(104), unrelated: id(105), fallStart: id(106), fallEndExclusive: id(107) };
const regularJob = id(201), regularDelivery = id(202), regularVersion = id(203), draftJob = id(204), draftDelivery = id(205);
let checks = 0;

function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

function json(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function civilDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  throw new TypeError(`Expected a PostgreSQL date value, received ${String(value)}`);
}

async function as(actor, sql, params = []) {
  await db.query("select set_config('test.actor', $1, false)", [actor]);
  await db.exec("set role authenticated");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

try {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;

    create table public.profiles (
      id uuid primary key, role text not null, is_active boolean not null,
      full_name text, email text not null, worker_specialty text
    );
    create table public.manual_jobs (
      id uuid primary key, prism_number text not null, value_cents bigint not null,
      status text not null, created_by uuid not null, reviewed_by uuid,
      reviewed_at timestamptz, rejection_reason text, created_at timestamptz not null,
      pdf_path text
    );
    create table public.manual_job_workers (
      manual_job_id uuid not null, technician_id uuid not null, percentage_basis_points integer not null
    );
    create table public.jobs (id uuid primary key, archived_at timestamptz, current_delivery_id uuid);
    create table public.job_deliveries (id uuid primary key, job_id uuid not null, submitted boolean not null, superseded_at timestamptz);
    create table public.job_delivery_allocation_versions (id uuid primary key, delivery_id uuid not null, superseded_at timestamptz, voided_at timestamptz);
    create table public.job_delivery_financial_allocations (allocation_version_id uuid not null, participant_id uuid not null);
    create table public.job_work_participants (job_id uuid not null, technician_id uuid not null, informational_basis_points integer);
    create table public.job_assignments (job_id uuid not null, assignee_type text not null, technician_id uuid, crew_id uuid, active boolean not null);
    create table public.crews (id uuid primary key, is_active boolean not null, lead_technician_id uuid not null);
    create table public.crew_members (crew_id uuid not null, technician_id uuid not null);

    create function public.is_office_staff(check_user_id uuid default auth.uid()) returns boolean language sql stable as $$
      select exists (select 1 from public.profiles where id = check_user_id and is_active and role in ('admin', 'supervisor'))
    $$;
    create function public.is_field_worker(check_user_id uuid default auth.uid()) returns boolean language sql stable as $$
      select exists (select 1 from public.profiles where id = check_user_id and is_active and role = 'tecnico')
    $$;
    create function public.is_operational_worker(check_user_id uuid default auth.uid()) returns boolean language sql stable as $$
      select public.is_field_worker(check_user_id)
    $$;
    create function public.require_active_technician_shift(check_user_id uuid default auth.uid()) returns void language plpgsql as $$ begin return; end; $$;
    create function public.list_my_manual_jobs()
    returns table(
      id uuid, prism_number text, value_cents bigint, status text, created_by uuid,
      creator_name text, reviewed_by uuid, reviewer_name text, reviewed_at timestamptz,
      rejection_reason text, created_at timestamptz, pdf_path text, workers jsonb
    ) language plpgsql stable security definer set search_path = '' as $$ begin return; end; $$;
    create function public.can_view_job(
      check_job_id uuid,
      check_user_id uuid default auth.uid()
    ) returns boolean language plpgsql volatile security definer set search_path = '' as $$ begin return false; end; $$;
    create function public.can_mutate_job(
      check_job_id uuid,
      check_user_id uuid default auth.uid()
    ) returns boolean language plpgsql volatile security definer set search_path = '' as $$ begin return false; end; $$;
    grant usage on schema public, auth to authenticated, anon, service_role;
    grant execute on function public.list_my_manual_jobs() to public, anon, authenticated, service_role;
    grant execute on function public.can_view_job(uuid, uuid) to public, anon, authenticated, service_role;
    grant execute on function public.can_mutate_job(uuid, uuid) to public, anon, authenticated, service_role;
  `);

  await db.exec(await readFile(new URL("../supabase/migrations/20260915030000_manual_work_participant_visibility.sql", import.meta.url), "utf8"));
  // Supabase creates new functions with an explicit service_role grant. Model
  // that platform default before applying the narrowly scoped correction.
  await db.exec(`
    grant execute on function public.get_my_weekly_manual_earnings(date) to service_role;
    grant execute on function public.get_my_job_work_participation(uuid) to service_role;
  `);
  equal((await db.query(`select bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) as allowed
    from pg_proc where oid in (
      'public.get_my_weekly_manual_earnings(date)'::regprocedure,
      'public.get_my_job_work_participation(uuid)'::regprocedure
    )`)).rows[0].allowed, true, "PGlite models Supabase's new-RPC service role default before the correction");
  await db.exec(await readFile(new URL("../supabase/migrations/20260915030001_revoke_manual_visibility_service_role.sql", import.meta.url), "utf8"));

  await db.query(`insert into public.profiles (id, role, is_active, full_name, email, worker_specialty) values
    ($1, 'tecnico', true, 'Creator', 'creator@example.test', 'tecnico'),
    ($2, 'tecnico', true, 'Hourly Helper', 'helper@example.test', 'ayudante'),
    ($3, 'tecnico', true, 'Percentage Helper', 'percentage@example.test', 'tecnico'),
    ($4, 'tecnico', true, 'Outsider', 'outsider@example.test', 'tecnico'),
    ($5, 'tecnico', true, 'Lead', 'lead@example.test', 'tecnico'),
    ($6, 'admin', true, 'Office', 'office@example.test', null)`,
  [creator, helper, percentageHelper, outsider, lead, office]);

  await db.query(`insert into public.manual_jobs values
    ($1, 'PENDING', 10000, 'pending', $2, null, null, null, '2026-03-07T12:00:00-05:00', null),
    ($3, 'APPROVED-ROUND', 101, 'approved', $2, $6, '2026-03-06T05:00:00Z', null, '2026-03-06T05:00:00Z', null),
    ($4, 'REJECTED', 20000, 'rejected', $2, $6, '2026-03-08T12:00:00-05:00', 'Rejected fixture', '2026-03-08T12:00:00-05:00', null),
    ($5, 'END-EXCLUSIVE', 30000, 'approved', $2, $6, '2026-03-13T04:00:00Z', null, '2026-03-13T04:00:00Z', null),
    ($7, 'UNRELATED', 9999, 'pending', $8, null, null, null, '2026-03-08T12:00:00-05:00', null),
    ($9, 'FALL-START', 100, 'approved', $2, $6, '2026-10-30T04:00:00Z', null, '2026-10-30T04:00:00Z', null),
    ($10, 'FALL-END-EXCLUSIVE', 100, 'approved', $2, $6, '2026-11-06T05:00:00Z', null, '2026-11-06T05:00:00Z', null)`,
  [manual.pending, creator, manual.approved, manual.rejected, manual.endExclusive, office, manual.unrelated, outsider, manual.fallStart, manual.fallEndExclusive]);
  await db.query(`insert into public.manual_job_workers values
    ($1, $2, 3333), ($1, $3, 6667),
    ($4, $2, 3333), ($5, $2, 5000), ($6, $2, 5000),
    ($7, $2, 10000), ($8, $2, 10000)`,
  [manual.pending, helper, percentageHelper, manual.approved, manual.rejected, manual.endExclusive, manual.fallStart, manual.fallEndExclusive]);

  const creatorRows = (await as(creator, "select * from public.list_my_manual_jobs() where id = $1", [manual.pending])).rows;
  equal(creatorRows.length, 1, "Creator sees the manual record");
  equal(json(creatorRows[0].workers).map((worker) => worker.technicianId).sort(), [helper, percentageHelper].sort(), "Creator retains the full split");

  const helperRows = (await as(helper, "select * from public.list_my_manual_jobs() order by id")).rows;
  equal(helperRows.map((row) => row.id).includes(manual.pending), true, "Listed helper sees pending manual work");
  equal(helperRows.map((row) => row.id).includes(manual.rejected), true, "Listed helper sees rejected manual work");
  equal(helperRows.map((row) => row.id).includes(manual.unrelated), false, "Unrelated manual work is not visible");
  const outsiderRows = (await as(outsider, "select * from public.list_my_manual_jobs() order by id")).rows;
  equal(outsiderRows.map((row) => row.id).includes(manual.pending), false, "An unrelated technician is denied the listed worker's manual record");
  const helperPending = helperRows.find((row) => row.id === manual.pending);
  equal(json(helperPending.workers).map((worker) => worker.technicianId), [helper], "Listed helper receives only their own split");
  equal(json(helperRows.find((row) => row.id === manual.approved).workers)[0].allocatedCents, 34, "Manual share uses established rounded cents");

  const springRows = (await as(helper, "select * from public.get_my_weekly_manual_earnings($1::date)", ["2026-03-10"])).rows;
  equal(springRows.map((row) => row.manual_job_id), [manual.approved], "Only approved manual work within the half-open spring DST week earns money");
  equal(springRows[0].allocated_cents, 34, "Approved manual earnings keep the rounded worker share");
  equal([civilDate(springRows[0].week_start), civilDate(springRows[0].week_end_exclusive)], ["2026-03-06", "2026-03-13"], "Manual earnings report Friday-to-next-Friday boundaries");
  equal((Date.parse("2026-03-13T00:00:00-04:00") - Date.parse("2026-03-06T00:00:00-05:00")) / 3_600_000, 167, "Spring DST week keeps New York civil boundaries");

  const fallRows = (await as(helper, "select * from public.get_my_weekly_manual_earnings($1::date)", ["2026-11-03"])).rows;
  equal(fallRows.map((row) => row.manual_job_id), [manual.fallStart], "Fall DST end boundary remains exclusive");
  equal((Date.parse("2026-11-06T00:00:00-05:00") - Date.parse("2026-10-30T00:00:00-04:00")) / 3_600_000, 169, "Fall DST week keeps New York civil boundaries");

  // Feed real authorized RPC results through the operational transform/render.
  const officeSql = await readFile(new URL("../supabase/migrations/20260825030000_manual_job_pdf.sql", import.meta.url), "utf8");
  const officeFunction = officeSql.match(/create function public\.list_manual_jobs_for_office\(\)[\s\S]*?\$\$;/u)?.[0];
  assert.ok(officeFunction, "Existing office RPC must be available");
  await db.exec(officeFunction);
  await db.exec("revoke all on function public.list_manual_jobs_for_office() from public; grant execute on function public.list_manual_jobs_for_office() to authenticated;");
  const registered = [id(301), id(302), id(303), id(304), id(305), id(306), id(307)];
  await db.query(`insert into public.manual_jobs values
    ($1, 'START', 10000, 'pending', $8, null, null, null, '2026-09-11T04:00:00Z', null),
    ($2, 'APPROVED-LATER', 10000, 'approved', $8, $9, '2026-09-20T12:00:00Z', null, '2026-09-12T12:00:00Z', null),
    ($3, 'REJECTED-WORK', 10000, 'rejected', $8, $9, '2026-09-14T12:00:00Z', null, '2026-09-13T12:00:00Z', null),
    ($4, 'FOURTH', 10000, 'pending', $8, null, null, null, '2026-09-18T03:59:59.999Z', null),
    ($5, 'OLDER-APPROVED-NOW', 10000, 'approved', $8, $9, '2026-09-12T12:00:00Z', null, '2026-09-11T03:59:59.999Z', null),
    ($6, 'NEXT-WEEK', 10000, 'pending', $8, null, null, null, '2026-09-18T04:00:00Z', null),
    ($7, 'UNRELATED-WEEK', 10000, 'pending', $10, null, null, null, '2026-09-12T12:00:00Z', null)`,
  [...registered, creator, office, outsider]);
  for (const manualId of registered.slice(0, 6)) {
    await db.query("insert into public.manual_job_workers values ($1, $2, 5000), ($1, $3, 5000)", [manualId, helper, percentageHelper]);
  }
  const load = workListLoader(workListUiStubs);
  const { filterManualWork } = load("src/lib/jobs/work-list.ts");
  const { WorkJobCards } = load("src/components/jobs/job-list.tsx");
  const week = { referenceAt: new Date("2026-09-16T12:00:00Z") };
  const listFor = async (actor, rpc) => (await as(actor, `select * from public.${rpc}()`)).rows.map((row) => ({
    ...row, created_at: new Date(row.created_at).toISOString(), workers: json(row.workers),
  }));
  const participantWeek = filterManualWork(await listFor(helper, "list_my_manual_jobs"), week);
  equal(Array.from(participantWeek, (job) => job.id).sort(), registered.slice(0, 4).sort(), "Registration week includes four authorized manual records regardless of approval week or native status");
  equal(participantWeek.every((job) => job.workers.length === 1 && job.workers[0].technicianId === helper), true, "Combined list preserves RPC participant-only roster visibility");
  const officeWeek = filterManualWork(await listFor(office, "list_manual_jobs_for_office"), week);
  equal(officeWeek.length, 5, "Office shared list includes authorized jobs from all creators");
  await assert.rejects(() => listFor(helper, "list_manual_jobs_for_office"), /Office access required/u);
  const unrelatedWeek = filterManualWork(await listFor(outsider, "list_my_manual_jobs"), week);
  equal(Array.from(unrelatedWeek, (job) => job.id), [registered[6]], "Unrelated user sees only their own record, never another participant's jobs");
  for (const manualJobs of [participantWeek, officeWeek]) {
    const tree = WorkJobCards({ jobs: [{ id: registered[0], prism_number: "REGULAR", main_status: "asignado", created_at: "2026-09-11T04:00:00Z" }], manualJobs });
    const hrefs = workListNodes(tree).filter((node) => node.type === "Link").map((node) => node.props.href);
    equal(hrefs.includes(`/trabajos/${registered[0]}`), true, "Actual cards retain the normal job route");
    equal(hrefs.filter((href) => href.startsWith("/manual#")).length, manualJobs.length, "Both role lists render every manual item beside the normal job, even above three");
  }
  equal((await as(helper, "select manual_job_id from public.get_my_weekly_manual_earnings('2026-09-16'::date)")).rows.map((row) => row.manual_job_id), [registered[4]], "Money remains approval-week based even when the operational list excludes that older registration");
  equal((await as(helper, "select manual_job_id from public.get_my_weekly_manual_earnings('2026-09-23'::date)")).rows.map((row) => row.manual_job_id), [registered[1]], "Later approval earns in its approval week without redisplaying the earlier operational job");

  await db.query("insert into public.jobs values ($1, null, $2), ($3, null, $4)", [regularJob, regularDelivery, draftJob, draftDelivery]);
  await db.query("insert into public.job_deliveries values ($1, $2, true, null), ($3, $4, false, null)", [regularDelivery, regularJob, draftDelivery, draftJob]);
  await db.query("insert into public.job_delivery_allocation_versions values ($1, $2, null, null)", [regularVersion, regularDelivery]);
  await db.query("insert into public.job_delivery_financial_allocations values ($1, $2)", [regularVersion, percentageHelper]);
  await db.query("insert into public.job_work_participants values ($1, $2, 2500), ($3, $2, 2000)", [regularJob, helper, draftJob]);
  await db.query("insert into public.job_assignments values ($1, 'technician', $2, null, true)", [regularJob, lead]);

  equal((await as(helper, "select public.can_view_job($1, $2) as allowed", [regularJob, helper])).rows[0].allowed, true, "Submitted hourly helper can read the regular job");
  equal((await as(helper, "select * from public.get_my_job_work_participation($1)", [regularJob])).rows.map((row) => row.informational_basis_points), [2500], "Hourly helper receives only their informational participation percentage");
  equal((await as(helper, "select public.can_mutate_job($1, $2) as allowed", [regularJob, helper])).rows[0].allowed, false, "Hourly helper read access does not grant job mutation");
  equal((await as(lead, "select public.can_mutate_job($1, $2) as allowed", [regularJob, lead])).rows[0].allowed, true, "Assigned lead retains job mutation access");
  equal((await as(percentageHelper, "select public.can_view_job($1, $2) as allowed", [regularJob, percentageHelper])).rows[0].allowed, true, "Percentage helper keeps allocation-based read access");
  equal((await db.query("select participant_id from public.job_delivery_financial_allocations where allocation_version_id = $1", [regularVersion])).rows.map((row) => row.participant_id), [percentageHelper], "Percentage helper allocation remains the only job-money row");
  equal((await as(percentageHelper, "select * from public.get_my_job_work_participation($1)", [regularJob])).rows, [], "Percentage helper does not receive a duplicate hourly participation record");
  equal((await as(helper, "select public.can_view_job($1, $2) as allowed", [draftJob, helper])).rows[0].allowed, false, "Unsubmitted allocation draft grants no helper visibility");
  equal((await as(helper, "select * from public.get_my_job_work_participation($1)", [draftJob])).rows, [], "Unsubmitted allocation draft has no participation record");

  const functionRows = (await db.query(`select oid::regprocedure::text as signature, proconfig
    from pg_proc where oid in (
      'public.list_my_manual_jobs()'::regprocedure,
      'public.get_my_weekly_manual_earnings(date)'::regprocedure,
      'public.get_my_job_work_participation(uuid)'::regprocedure,
      'public.can_view_job(uuid,uuid)'::regprocedure,
      'public.can_mutate_job(uuid,uuid)'::regprocedure
    ) order by 1`)).rows;
  equal(functionRows.every((row) => row.proconfig?.includes('search_path=""')), true, "All new or replaced security-definer functions fix an empty search path");
  const aclRows = (await db.query(`select oid::regprocedure::text as signature,
    has_function_privilege('public', oid, 'EXECUTE') as public_execute,
    has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', oid, 'EXECUTE') as service_role_execute
    from pg_proc where oid in (
      'public.list_my_manual_jobs()'::regprocedure,
      'public.get_my_weekly_manual_earnings(date)'::regprocedure,
      'public.get_my_job_work_participation(uuid)'::regprocedure,
      'public.can_view_job(uuid,uuid)'::regprocedure,
      'public.can_mutate_job(uuid,uuid)'::regprocedure
    ) order by 1`)).rows;
  const expectedAcl = {
    'can_mutate_job(uuid,uuid)': { public_execute: false, anon_execute: false, authenticated_execute: true, service_role_execute: true },
    'can_view_job(uuid,uuid)': { public_execute: false, anon_execute: false, authenticated_execute: true, service_role_execute: true },
    'get_my_job_work_participation(uuid)': { public_execute: false, anon_execute: false, authenticated_execute: true, service_role_execute: false },
    'get_my_weekly_manual_earnings(date)': { public_execute: false, anon_execute: false, authenticated_execute: true, service_role_execute: false },
    'list_my_manual_jobs()': { public_execute: false, anon_execute: false, authenticated_execute: true, service_role_execute: true },
  };
  equal(aclRows.map((row) => row.signature), Object.keys(expectedAcl), "The migration covers the ACL for every affected RPC");
  for (const row of aclRows) {
    for (const [role, expected] of Object.entries(expectedAcl[row.signature])) {
      equal(row[role], expected, `${row.signature} ${role} matches the explicit execution policy`);
    }
  }
  await db.exec("set role anon");
  try {
    equal((await db.query("select has_function_privilege('anon', 'public.get_my_weekly_manual_earnings(date)', 'EXECUTE') as allowed")).rows[0].allowed, false, "Anonymous callers cannot execute the manual earnings RPC");
  } finally {
    await db.exec("reset role");
  }

  console.log(`PASS manual work SQL: ${checks} behavioral checks; real migration functions in disposable in-memory PGlite only`);
} finally {
  await db.close();
}
