import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Disposable local PostgreSQL only. No environment files or remote clients.
if (!process.argv[2]) throw new Error("Pass an installed local PGlite entry path");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [admin, supervisor, worker, helper, outsider, auditor, inactive] = Array.from({ length: 7 }, (_, n) => id(n + 1));
const regular = id(100), delivery = id(101), version = id(102), legacy = id(200);
let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
const date = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value;
const migration = async (name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");

async function installFunction(file, name) {
  const source = await migration(file);
  const definition = source.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "u"))?.[0];
  assert.ok(definition, `${file} defines ${name}`);
  await db.exec(definition);
}

async function as(actor, sql, params = []) {
  await db.query("select set_config('test.actor', $1, false)", [actor]);
  await db.exec("set role authenticated");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role"); }
}

try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create table public.profiles (
      id uuid primary key, role text, is_active boolean, full_name text, email text, worker_specialty text
    );
    create function public.is_office_staff(check_user_id uuid default auth.uid()) returns boolean language sql stable as $$
      select exists(select 1 from public.profiles where id = check_user_id and is_active and role in ('admin', 'supervisor'))
    $$;
    create function public.is_office_viewer(check_user_id uuid default auth.uid()) returns boolean language sql stable as $$
      select exists(select 1 from public.profiles where id = check_user_id and is_active and role in ('admin', 'supervisor', 'auditor'))
    $$;
    create function public.is_field_worker(check_user_id uuid default auth.uid()) returns boolean language sql stable as $$
      select exists(select 1 from public.profiles where id = check_user_id and is_active and role = 'tecnico')
    $$;
    create table public.jobs (id uuid primary key, prism_number text, main_status text, current_delivery_id uuid, reviewed_at timestamptz);
    create table public.job_deliveries (id uuid primary key, job_id uuid, submitted boolean, superseded_at timestamptz, confirmed_at timestamptz);
    create table public.job_delivery_allocation_versions (
      id uuid primary key, job_id uuid, delivery_id uuid, superseded_at timestamptz, voided_at timestamptz, source_amount_cents bigint
    );
    create table public.job_delivery_financial_allocations (
      allocation_version_id uuid, participant_id uuid, percentage_basis_points integer, allocated_cents bigint,
      participant_name_snapshot text, worker_specialty_snapshot text
    );
    create table public.technician_shifts (started_at timestamptz, fuel_amount numeric);
    grant usage on schema public, auth to authenticated, anon, service_role;
  `);
  await db.exec(await migration("20260820015000_manual_jobs"));
  await db.exec(await migration("20260825030000_manual_job_pdf"));
  await installFunction("20260915030000_manual_work_participant_visibility", "list_my_manual_jobs");
  await installFunction("20260915030000_manual_work_participant_visibility", "get_my_weekly_manual_earnings");
  for (const name of ["get_worker_weekly_financial_dashboard", "get_financial_history", "list_manual_jobs_for_office"]) {
    await installFunction("20260916020000_auditor_readonly_access", name);
  }
  const auditorPolicies = (await migration("20260916020000_auditor_readonly_access"))
    .match(/drop policy if exists "manual_jobs_select"[\s\S]*?(?=-- job_imports)/u)?.[0];
  assert.ok(auditorPolicies, "Latest manual table read policies are available");
  await db.exec(auditorPolicies);
  await installFunction("20260817012000_job_state_machine_and_permissions", "get_my_weekly_financial_allocations");
  await db.exec(await migration("20260905020000_weekly_export"));
  await db.exec("grant select on public.manual_jobs, public.manual_job_workers, public.profiles to authenticated");
  for (const [actor, role, active] of [[admin, "admin", true], [supervisor, "supervisor", true], [worker, "tecnico", true], [helper, "tecnico", true], [outsider, "tecnico", true], [auditor, "auditor", true], [inactive, "admin", false]]) {
    await db.query("insert into public.profiles values ($1, $2, $3, $2, $2 || '@example.test', 'tecnico')", [actor, role, active]);
  }
  await db.query("insert into public.jobs values ($1, 'THURSDAY', 'en_revision', $2, null)", [regular, delivery]);
  await db.query("insert into public.job_deliveries values ($1, $2, true, null, '2026-03-13T03:59:59Z')", [delivery, regular]);
  await db.query("insert into public.job_delivery_allocation_versions values ($1, $2, $3, null, null, 10000)", [version, regular, delivery]);
  await db.query("insert into public.job_delivery_financial_allocations values ($1, $2, 10000, 10000, 'Worker', 'tecnico')", [version, worker]);
  await db.query(`insert into public.manual_jobs (id, prism_number, value_cents, status, created_by, created_at, reviewed_at, reviewed_by)
    values ($1, 'LEGACY', 5000, 'approved', $2, '2026-03-12T18:00:00Z', '2026-03-14T18:00:00Z', $3)`, [legacy, worker, admin]);
  await db.query("insert into public.manual_job_workers (manual_job_id, technician_id, percentage_basis_points) values ($1, $2, 10000)", [legacy, worker]);
  await db.query(`insert into public.manual_jobs (id, prism_number, value_cents, status, created_by, created_at, reviewed_at, reviewed_by)
    values ($1, 'LEGACY-PENDING', 7000, 'pending', $3, '2026-03-12T18:00:00Z', null, null),
      ($2, 'LEGACY-REJECTED', 8000, 'rejected', $3, '2026-03-12T18:00:00Z', '2026-03-14T18:00:00Z', $4)`, [id(201), id(202), worker, admin]);
  await db.query(`insert into public.manual_job_workers (manual_job_id, technician_id, percentage_basis_points)
    values ($1, $3, 10000), ($2, $3, 10000)`, [id(201), id(202), worker]);

  const weekly = (ref) => as(worker, "select * from public.get_my_weekly_financial_allocations($1::date)", [ref]);
  equal((await weekly("2026-03-12"))[0].billing_state, "pending", "Thursday submission is present before approval");
  await db.query("update public.jobs set main_status = 'aprobado', reviewed_at = '2026-03-14T18:00:00Z' where id = $1", [regular]);
  equal((await weekly("2026-03-12"))[0].billing_state, "confirmed", "Saturday approval confirms the Thursday submission week");
  equal((await weekly("2026-03-14")).length, 0, "Approval does not move regular earnings to Saturday's week");
  equal((await as(worker, "select * from public.get_my_weekly_export('2026-03-12')"))[0].allocated_cents, 10000, "Regular export agrees with submission week");
  equal((await as(admin, "select * from public.get_worker_weekly_financial_dashboard('2026-03-12T12:00:00Z')"))[0].allocated_cents, 10000, "Office dashboard agrees with submission week");
  equal((await as(admin, "select * from public.get_financial_history('2026-03-12', '2026-03-12')"))[0].worker_expense_cents, 10000, "History agrees with Thursday submission");
  equal((await as(worker, "select * from public.get_my_weekly_manual_earnings('2026-03-12')")).length, 0, "Legacy manual excludes registration week");
  equal((await as(worker, "select * from public.get_my_weekly_manual_earnings('2026-03-14')"))[0].allocated_cents, 5000, "Legacy manual retains approval week");
  for (const [instant, reference, expected] of [
    ["2026-03-06T04:59:59Z", "2026-03-06", 0], ["2026-03-06T05:00:00Z", "2026-03-06", 1],
    ["2026-03-13T03:59:59Z", "2026-03-06", 1], ["2026-03-13T04:00:00Z", "2026-03-06", 0],
    ["2026-10-30T03:59:59Z", "2026-10-30", 0], ["2026-10-30T04:00:00Z", "2026-10-30", 1],
    ["2026-11-06T04:59:59Z", "2026-10-30", 1], ["2026-11-06T05:00:00Z", "2026-10-30", 0],
  ]) {
    await db.query("update public.job_deliveries set confirmed_at = $1 where id = $2", [instant, delivery]);
    equal((await weekly(reference)).length, expected, `New York half-open Friday/DST boundary ${instant}`);
  }
  await db.query("update public.job_deliveries set confirmed_at = '2026-03-13T03:59:59Z' where id = $1", [delivery]);

  const legacySnapshot = async () => (await db.query(`select to_jsonb(m) - 'description' - 'work_date' - 'financial_week_start' - 'revision' as row
    from public.manual_jobs m where id in ($1, $2, $3) order by id`, [legacy, id(201), id(202)])).rows;
  const oldReports = async () => ({
    earnings: await as(worker, "select * from public.get_my_weekly_manual_earnings('2026-03-14')"),
    history: await as(auditor, "select * from public.get_financial_history('2026-03-01', '2026-03-19')"),
    office: await as(auditor, "select * from public.get_worker_weekly_financial_dashboard('2026-03-14T12:00:00Z')"),
    workers: (await db.query("select * from public.manual_job_workers where manual_job_id in ($1, $2, $3) order by manual_job_id, id", [legacy, id(201), id(202)])).rows,
  });
  const beforeLegacy = await legacySnapshot(), beforeReports = await oldReports();
  // The only clock replacement is inside this disposable test database. Real
  // migration/RPC bodies run unchanged, with a deterministic server-owned clock.
  await db.exec(`create or replace function pg_catalog.clock_timestamp() returns timestamptz
    language sql volatile as $$ select current_setting('test.now')::timestamptz $$;`);
  await db.query("select set_config('test.now', '2026-03-20T12:00:00Z', false)");
  await db.exec(`create or replace function pg_catalog.now() returns timestamptz
    language sql stable as $$ select coalesce(nullif(current_setting('test.transaction_time', true), ''), current_setting('test.now'))::timestamptz $$;`);
  await db.exec(await migration("20260922010000_manual_office_week_cutoff"));
  equal(await legacySnapshot(), beforeLegacy, "Migration preserves every pre-existing manual column byte-equivalently");
  equal(await oldReports(), beforeReports, "Migration preserves old-week earnings/history/office output and legacy worker rows");
  const context = (await as(admin, "select * from public.get_manual_job_creation_context()"))[0];
  equal(date(context.first_financial_week), "2026-03-20", "Activation uses the database's New York Friday period");
  const split = [{ technicianId: worker, percentageBasisPoints: 6000 }, { technicianId: helper, percentageBasisPoints: 4000 }];
  const create = (actor, overrides = {}) => {
    const input = { prism: " office ", value: 10000, workers: split, description: "Completed field work", workDate: "2026-03-19", week: "2026-03-20", ...overrides };
    return as(actor, "select public.create_manual_job_v2($1, $2, $3::jsonb, $4, $5::date, $6::date) as id",
      [input.prism, input.value, JSON.stringify(input.workers), input.description, input.workDate, input.week]);
  };
  const adminJob = (await create(admin))[0].id;
  const supervisorJob = (await create(supervisor, { week: "2026-04-03" }))[0].id;
  equal((await db.query("select status from public.manual_jobs where id = $1", [adminJob])).rows[0].status, "pending", "Office creation remains pending, never auto-approved");
  equal((await db.query("select created_by from public.manual_jobs where id = $1", [supervisorJob])).rows[0].created_by, supervisor, "Supervisor can create");
  for (const actor of [auditor, inactive, ""]) {
    await assert.rejects(() => create(actor), /access required/u);
    checks += 1;
  }
  await assert.rejects(() => create(worker), /Only office staff/u);
  checks += 1;
  const rowCount = async () => (await db.query("select (select count(*) from public.manual_jobs) as jobs, (select count(*) from public.manual_job_workers) as workers")).rows;
  for (const invalid of [
    { prism: " " }, { value: 0 }, { description: "" }, { workDate: "2026-03-21" }, { week: "2026-03-13" },
    { week: "2026-03-21" }, { week: "infinity" }, { workers: [] }, { workers: [{ technicianId: worker, percentageBasisPoints: 5000 }] },
    { workers: [{ technicianId: inactive, percentageBasisPoints: 10000 }] },
    { workers: [{ technicianId: worker, percentageBasisPoints: 5000 }, { technicianId: worker, percentageBasisPoints: 5000 }] },
    { workers: [{ technicianId: worker, percentageBasisPoints: "bad" }] },
  ]) {
    const before = await rowCount();
    await assert.rejects(() => create(admin, invalid));
    equal(await rowCount(), before, "Invalid creation leaves headers and splits unchanged");
  }
  await db.query("select set_config('test.now', '2026-03-27T03:59:59Z', false)");
  const techJob = (await as(worker, "select public.create_manual_job('THURSDAY-TECH', 10000, $1::jsonb) as id", [JSON.stringify(split)]))[0].id;
  equal(new Date((await db.query("select created_at from public.manual_jobs where id = $1", [techJob])).rows[0].created_at).toISOString(), "2026-03-27T03:59:59.000Z", "Actual technician creation persists the simulated Thursday registration timestamp");
  equal(date((await db.query("select financial_week_start from public.manual_jobs where id = $1", [techJob])).rows[0].financial_week_start), "2026-03-20", "Old technician signature stamps new Thursday records in submission week");
  await db.query("select set_config('test.now', '2026-03-28T16:00:00Z', false)");
  for (const job of [adminJob, supervisorJob, techJob]) {
    await as(admin, "select public.review_manual_job($1, true)", [job]);
  }
  const earnings = await as(worker, "select * from public.get_my_weekly_manual_earnings_v2('2026-03-20')");
  equal(earnings.map((r) => r.manual_job_id).sort(), [adminJob, techJob].sort(), "Saturday approval retains office-selected and technician-submission weeks");
  equal(earnings.map((r) => [date(r.financial_date), date(r.approval_date)]), [["2026-03-20", "2026-03-28"], ["2026-03-20", "2026-03-28"]], "Financial date is not misnamed approval date");
  equal((await as(worker, "select * from public.get_my_weekly_manual_earnings_v2('2026-04-03')"))[0].manual_job_id, supervisorJob, "Explicit selected week is independent of work/creation/approval dates");
  const officeRows = await as(auditor, "select * from public.get_worker_weekly_financial_dashboard('2026-03-20T12:00:00Z')");
  equal(officeRows.find((r) => r.participant_id === worker).allocated_cents, earnings.reduce((n, r) => n + r.allocated_cents, 0), "Worker earnings and office report agree");
  equal((await as(auditor, "select * from public.get_financial_history('2026-03-20', '2026-03-20')"))[0].worker_expense_cents, 20000, "History allocates new manual totals to selected Friday");
  const list = async (actor) => (await as(actor, "select public.list_manual_jobs_v2() as job")).map((r) => r.job);
  equal((await list(helper)).find((r) => r.id === techJob).workers.map((w) => w.technicianId), [helper], "Non-creator participant sees only own split");
  equal((await list(worker)).find((r) => r.id === techJob).workers.length, 2, "Technician creator retains full split");
  equal((await list(outsider)).length, 0, "Unrelated technician cannot read other records");
  equal((await list(auditor)).find((r) => r.id === adminJob).workers.length, 2, "Auditor retains office read access");
  await assert.rejects(() => list(inactive), /Active manual job viewer required/u);
  checks += 1;
  equal((await as(auditor, "select id from public.manual_jobs where id = $1", [techJob])).length, 1, "Latest table policy allows auditor receipt header reads");
  equal((await as(helper, "select technician_id from public.manual_job_workers where manual_job_id = $1", [techJob])).map((r) => r.technician_id), [helper], "Table RLS also hides other participant rows");
  await db.query("update public.job_deliveries set confirmed_at = '2026-03-26T18:00:00Z' where id = $1", [delivery]);
  const mixed = await as(admin, "select * from public.get_worker_weekly_financial_dashboard('2026-03-26T12:00:00Z')");
  equal(mixed.filter((r) => r.participant_id === worker).length, 2, "SQL retains separate regular/manual rows for the same worker (known office consumer limitation)");
  await db.query("update public.job_deliveries set confirmed_at = '2026-03-13T03:59:59Z' where id = $1", [delivery]);
  equal(await oldReports(), beforeReports, "New records and approvals leave pre-activation reports unchanged");

  const beforeEditMigration = await legacySnapshot();
  await db.exec(await migration("20260922020000_manual_office_edits"));
  equal(await legacySnapshot(), beforeEditMigration, "Edit migration does not rewrite legacy rows");
  equal(await oldReports(), beforeReports, "Edit migration does not change historic reports");
  const receipt = `manual-jobs/${techJob}/revision-1.pdf`;
  await as(worker, "select public.set_manual_job_pdf_path_v2($1, 1, $2)", [techJob, receipt]);
  const snapshot = async (jobId) => ({
    job: (await db.query("select * from public.manual_jobs where id = $1", [jobId])).rows[0],
    workers: (await db.query("select * from public.manual_job_workers where manual_job_id = $1 order by technician_id, id", [jobId])).rows,
    audit: (await db.query("select * from public.manual_job_edits where manual_job_id = $1 order by to_revision", [jobId])).rows,
  });
  const beforeEdit = await snapshot(techJob);
  const update = (actor, overrides = {}) => {
    const input = { job: techJob, revision: 1, prism: "CORRECTED", value: 20000,
      workers: [{ technicianId: helper, percentageBasisPoints: 10000 }],
      description: "Corrected work", workDate: "2026-03-25", week: "2026-04-03", ...overrides };
    return as(actor, "select public.update_manual_job($1, $2, $3, $4, $5::jsonb, $6, $7::date, $8::date) as revision",
      [input.job, input.revision, input.prism, input.value, JSON.stringify(input.workers), input.description, input.workDate, input.week]);
  };
  for (const actor of [worker, helper, outsider, auditor, inactive, ""]) {
    await assert.rejects(() => update(actor), /Office access required/u);
    equal(await snapshot(techJob), beforeEdit, "Denied editor leaves record, splits, receipt and audit unchanged");
    await assert.rejects(() => as(actor, "select public.review_manual_job($1, true)", [techJob]), /Office access required/u);
    checks += 1;
  }
  await assert.rejects(() => update(admin, { job: legacy }), /Legacy manual jobs cannot be edited/u);
  equal(await legacySnapshot(), beforeLegacy, "Legacy editor denial leaves previous values untouched");
  for (const invalid of [
    { revision: null }, { revision: 0 }, { value: -1 }, { value: 9007199254740992 },
    { workers: [] }, { workers: [{ technicianId: worker, percentageBasisPoints: 8000 }] },
    { workers: [{ technicianId: helper, percentageBasisPoints: 5000 }, { technicianId: helper, percentageBasisPoints: 5000 }] },
    { workDate: "infinity" }, { workDate: "2026-03-29" }, { week: "2026-03-13" },
    { week: "2026-03-21" }, { description: "" }, { description: "x".repeat(2001) },
  ]) {
    await assert.rejects(() => update(admin, invalid));
    equal(await snapshot(techJob), beforeEdit, "Invalid edit rolls back all state");
  }
  // Force a failure after header/split changes to prove transaction atomicity.
  await db.exec(`create function public.test_reject_audit() returns trigger language plpgsql as $$
    begin raise exception 'Injected audit failure'; end; $$;
    create trigger test_reject_audit before insert on public.manual_job_edits
      for each row execute function public.test_reject_audit();`);
  await assert.rejects(() => update(admin), /Injected audit failure/u);
  equal(await snapshot(techJob), beforeEdit, "Late audit failure restores header, worker IDs, receipt and revision");
  await db.exec("drop trigger test_reject_audit on public.manual_job_edits; drop function public.test_reject_audit()");
  await db.query("select set_config('test.now', '2026-03-29T16:00:00Z', false)");
  equal((await update(admin))[0].revision, 2, "Administrator edits approved job atomically");
  const afterEdit = await snapshot(techJob);
  equal([afterEdit.job.status, afterEdit.job.reviewed_at, afterEdit.job.reviewed_by, afterEdit.job.created_at],
    [beforeEdit.job.status, beforeEdit.job.reviewed_at, beforeEdit.job.reviewed_by, beforeEdit.job.created_at], "Approved edit preserves status, reviewer, approval time and registration time");
  equal(afterEdit.job.pdf_path, null, "Approved edit invalidates obsolete receipt pointer");
  equal(afterEdit.workers.map((w) => [w.technician_id, w.percentage_basis_points]), [[helper, 10000]], "Edit atomically replaces the worker split");
  equal(afterEdit.audit.length, 1, "Exactly one before/after audit event is recorded");
  const event = afterEdit.audit[0];
  equal([event.actor_id, event.from_revision, event.to_revision, event.before_snapshot.pdf_path, event.after_snapshot.pdf_path],
    [admin, 1, 2, receipt, null], "Audit records actor, revision and receipt invalidation");
  equal(event.before_snapshot.workers.map((w) => w.technician_id), beforeEdit.workers.map((w) => w.technician_id), "Audit preserves old split");
  equal(event.after_snapshot.workers.map((w) => w.technician_id), [helper], "Audit preserves new split");
  await assert.rejects(() => update(supervisor), /changed; reload/u);
  equal(await snapshot(techJob), afterEdit, "Second writer's stale revision cannot overwrite the first edit");
  await assert.rejects(() => as(worker, "select public.set_manual_job_pdf_path_v2($1, 1, $2)", [techJob, receipt]), /receipt is obsolete/u);
  await assert.rejects(() => as(admin, "select public.set_manual_job_pdf_path($1, $2)", [techJob, receipt]), /Versioned receipt required/u);
  equal((await snapshot(techJob)).job.pdf_path, null, "Racing initial upload and old setter cannot resurrect stale receipt");
  await as(supervisor, "select public.review_manual_job($1, true)", [techJob]);
  equal(await snapshot(techJob), afterEdit, "Repeated approval is idempotent for feature-era jobs");
  await assert.rejects(() => as(supervisor, "select public.review_manual_job($1, false)", [techJob]), /cannot be rejected/u);
  checks += 1;
  equal((await update(supervisor, { revision: 2, value: 25000 }))[0].revision, 3, "Supervisor can make a subsequent versioned correction");
  equal((await as(helper, "select * from public.get_my_weekly_manual_earnings_v2('2026-04-03')")).find((r) => r.manual_job_id === techJob).allocated_cents, 25000, "Edited earnings follow the selected week and new split");
  equal((await as(worker, "select * from public.get_my_weekly_manual_earnings_v2('2026-04-03')")).some((r) => r.manual_job_id === techJob), false, "Removed worker no longer receives new earnings");
  equal((await list(helper)).find((r) => r.id === techJob).workers.map((w) => w.technicianId), [helper], "Participant privacy holds after worker edits");
  equal(await oldReports(), beforeReports, "Corrections never change pre-activation cut reports");

  // Actual RLS/ACL attempts, not only function-body authorization assertions.
  await db.exec("grant insert, update, delete on public.manual_jobs, public.manual_job_workers to authenticated");
  equal((await as(admin, "update public.manual_jobs set value_cents = 1 where id = $1 returning id", [techJob])).length, 0, "Table RLS prevents bypassing the atomic editor");
  equal((await as(worker, "select * from public.manual_job_edits")).length, 0, "Workers cannot read audit snapshots containing full rosters");
  equal((await as(auditor, "select * from public.manual_job_edits")).length, 2, "Auditor retains read-only audit visibility");
  await assert.rejects(() => as(admin, "delete from public.manual_job_edits"), /permission denied/u);
  await assert.rejects(() => as(admin, "update public.manual_job_feature_activation set first_financial_week = '2020-01-03'"), /permission denied/u);
  checks += 2;
  const signatures = [
    "create_manual_job_v2(text,bigint,jsonb,text,date,date)", "get_manual_job_creation_context()",
    "list_manual_jobs_v2()", "get_my_weekly_manual_earnings_v2(date)",
    "update_manual_job(uuid,integer,text,bigint,jsonb,text,date,date)", "set_manual_job_pdf_path_v2(uuid,integer,text)",
  ];
  for (const signature of signatures) {
    const acl = (await db.query(`select has_function_privilege('anon', $1, 'execute') as anon,
      has_function_privilege('authenticated', $1, 'execute') as authenticated,
      has_function_privilege('service_role', $1, 'execute') as service`, [`public.${signature}`])).rows[0];
    equal(acl, { anon: false, authenticated: true, service: false }, `${signature} has an explicit least-privilege ACL`);
  }
  for (const [instant, expected] of [
    ["2026-10-30T03:59:59Z", "2026-10-23"], ["2026-10-30T04:00:00Z", "2026-10-30"],
    ["2026-11-06T04:59:59Z", "2026-10-30"], ["2026-11-06T05:00:00Z", "2026-11-06"],
    ["2027-03-12T04:59:59Z", "2027-03-05"], ["2027-03-12T05:00:00Z", "2027-03-12"],
    ["2027-03-19T03:59:59Z", "2027-03-12"], ["2027-03-19T04:00:00Z", "2027-03-19"],
  ]) {
    await db.query("select set_config('test.now', $1, false)", [instant]);
    // A transaction that started before Friday must not stamp a different
    // registration period from the actual submission clock captured by the RPC.
    await db.query("select set_config('test.transaction_time', $1, false)", [new Date(Date.parse(instant) - 3600000).toISOString()]);
    const created = (await as(worker, "select public.create_manual_job('DST', 10000, $1::jsonb) as id", [JSON.stringify(split)]))[0].id;
    const period = (await db.query(`select financial_week_start,
      (created_at at time zone 'America/New_York')::date
        - ((extract(dow from created_at at time zone 'America/New_York')::integer + 2) % 7) as registration_week
      from public.manual_jobs where id = $1`, [created])).rows[0];
    equal([date(period.financial_week_start), date(period.registration_week)], [expected, expected], `New technician financial/registration weeks share one server clock at Friday/DST ${instant}`);
  }

  console.log(`PASS manual office cutoff SQL: ${checks} behavioral checks; disposable local PGlite only`);
} finally {
  await db.close();
}
