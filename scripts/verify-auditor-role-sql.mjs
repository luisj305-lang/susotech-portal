import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Read-only 'auditor' role SQL harness. Verifies the core read/write split in a
// disposable in-memory PGlite: the real is_office_viewer predicate and the real
// policy split semantics, plus the non-negotiable invariant that is_office_staff
// does NOT widen to include 'auditor'.
//
// Run: node scripts/verify-auditor-role-sql.mjs <path-to-pglite-index.js>
if (!process.argv[2]) throw new Error("Pass a local @electric-sql/pglite/dist/index.js path");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), supervisor = id(2), auditor = id(3), inactiveAuditor = id(4), tecnico = id(5), outsider = id(6);
const job = id(101), manualJob = id(102), vehicle = id(103), wpJob = id(104);
const companyCategory = id(201), inhouseCategory = id(202);
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (condition, label) => { assert.equal(Boolean(condition), true, label); checks++; };
const denied = async (fn, pattern, label) => { await assert.rejects(fn, pattern, label); checks++; };

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

    create type public.user_role as enum ('admin', 'supervisor', 'tecnico');

    create table public.profiles (
      id uuid primary key, role public.user_role not null, is_active boolean not null,
      full_name text, email text not null
    );
    alter table public.profiles enable row level security;
    create policy "Users can view their own profile" on public.profiles for select to authenticated
      using (auth.uid() = id);
    create table public.jobs (id uuid primary key, title text not null, comments text, main_status text);
    create table public.manual_jobs (id uuid primary key, prism_number text not null, value_cents bigint not null, status text not null, created_by uuid not null);
    create table public.manual_job_workers (manual_job_id uuid not null, technician_id uuid not null, percentage_basis_points integer not null);
    create table public.fleet_vehicles (
      id uuid primary key,
      unit_number text not null,
      created_by uuid,
      updated_by uuid,
      updated_at timestamptz
    );
    create table public.fleet_vehicle_assignments (
      vehicle_id uuid not null,
      technician_id uuid not null,
      assignment_role text not null,
      starts_on date not null,
      ends_on date
    );
    create table public.job_assignments (id uuid primary key, job_id uuid not null, assignee_type text not null, technician_id uuid, crew_id uuid, active boolean not null default true);
    create table public.job_work_participants (job_id uuid not null, technician_id uuid not null, informational_basis_points integer);
    create table public.price_categories (id uuid primary key, slug text not null, name text not null, active boolean not null default true);
    create table public.calendar_reminders (id uuid primary key, title text not null, created_by uuid not null);

    alter table public.jobs enable row level security;
    alter table public.manual_jobs enable row level security;
    alter table public.manual_job_workers enable row level security;
    alter table public.fleet_vehicles enable row level security;
    alter table public.job_assignments enable row level security;
    alter table public.job_work_participants enable row level security;
    alter table public.price_categories enable row level security;
    alter table public.calendar_reminders enable row level security;

    create function public.is_admin(check_user_id uuid default auth.uid())
    returns boolean
    language sql
    stable
    security definer set search_path = ''
    as $$
      select exists (select 1 from public.profiles where id = check_user_id and role = 'admin')
    $$;

    revoke all on function public.is_admin(uuid) from public;
    grant execute on function public.is_admin(uuid) to authenticated;
    create function public.is_office_staff(check_user_id uuid default auth.uid())
    returns boolean
    language sql
    stable
    security definer set search_path = ''
    as $$
      select exists (select 1 from public.profiles where id = check_user_id and is_active and role in ('admin', 'supervisor'))
    $$;

    revoke all on function public.is_office_staff(uuid) from public;
    grant execute on function public.is_office_staff(uuid) to authenticated;
    create function public.is_technician(check_user_id uuid default auth.uid()) returns boolean language sql stable as $$
      select exists (select 1 from public.profiles where id = check_user_id and is_active and role = 'tecnico')
    $$;
    create function public.can_access_fleet_vehicle(check_vehicle_id uuid, check_user_id uuid default auth.uid())
    returns boolean
    language sql
    stable
    security definer set search_path = ''
    as $$
      select public.is_technician(check_user_id)
        and exists (
          select 1
          from public.fleet_vehicle_assignments assignment
          where assignment.vehicle_id = check_vehicle_id
            and assignment.technician_id = check_user_id
            and assignment.starts_on <= current_date
            and (assignment.ends_on is null or assignment.ends_on >= current_date)
        )
    $$;
    create function public.fleet_apply_audit_fields()
    returns trigger
    language plpgsql
    as $$
    begin
      new.created_by := coalesce(new.created_by, auth.uid());
      new.updated_by := coalesce(new.updated_by, auth.uid());
      return new;
    end;
    $$;

    grant usage on schema public, auth to authenticated, anon, service_role;
    grant all on all tables in schema public to authenticated;
  `);

  // Migration 1: add the enum value.
  await db.exec(await readFile(new URL("../supabase/migrations/20260916010000_add_auditor_role.sql", import.meta.url), "utf8"));

  // Extract and apply the real is_office_viewer predicate + grants from migration 2.
  const accessSql = await readFile(new URL("../supabase/migrations/20260916020000_auditor_readonly_access.sql", import.meta.url), "utf8");
  const viewer = accessSql.match(/create or replace function public\.is_office_viewer[\s\S]*?grant execute on function public\.is_office_viewer\(uuid\) to authenticated;/u)?.[0];
  assert.ok(viewer, "is_office_viewer definition must be present in migration 2");
  await db.exec(viewer);

  // Apply the real engine-hours and auditor-read migrations against the minimal
  // fleet schema so this verifies the production policy boundary, not a copy.
  await db.exec(await readFile(new URL("../supabase/migrations/20260917010000_fleet_engine_hours.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20260917020000_auditor_fleet_engine_hours_read.sql", import.meta.url), "utf8"));

  // Faithful subset of the migration 2 policy split for the tables under test.
  await db.exec(`
    -- jobs: select -> viewer, writes -> staff
    create policy "Office staff can view jobs" on public.jobs for select to authenticated using (public.is_office_viewer());
    create policy "Office staff can insert jobs" on public.jobs for insert to authenticated with check (public.is_office_staff());
    create policy "Office staff can update jobs" on public.jobs for update to authenticated using (public.is_office_staff()) with check (public.is_office_staff());
    create policy "Office staff can delete jobs" on public.jobs for delete to authenticated using (public.is_office_staff());

    -- manual_jobs: creator or viewer
    create policy "manual_jobs_select" on public.manual_jobs for select to authenticated using (auth.uid() = created_by or public.is_office_viewer());
    create policy "manual_job_workers_select" on public.manual_job_workers for select to authenticated using (
      auth.uid() = technician_id or public.is_office_viewer()
      or exists (select 1 from public.manual_jobs mj where mj.id = manual_job_id and mj.created_by = auth.uid())
    );

    -- fleet: select -> viewer, writes -> staff
    create policy "Office staff view fleet_vehicles" on public.fleet_vehicles for select to authenticated using (public.is_office_viewer());
    create policy "Office staff insert fleet_vehicles" on public.fleet_vehicles for insert to authenticated with check (public.is_office_staff());
    create policy "Office staff update fleet_vehicles" on public.fleet_vehicles for update to authenticated using (public.is_office_staff()) with check (public.is_office_staff());
    create policy "Office staff delete fleet_vehicles" on public.fleet_vehicles for delete to authenticated using (public.is_office_staff());

    -- job_assignments split
    create policy "Office staff can view assignments" on public.job_assignments for select to authenticated using (public.is_office_viewer());
    create policy "Office staff can insert assignments" on public.job_assignments for insert to authenticated with check (public.is_office_staff());
    create policy "Office staff can update assignments" on public.job_assignments for update to authenticated using (public.is_office_staff()) with check (public.is_office_staff());
    create policy "Office staff can delete assignments" on public.job_assignments for delete to authenticated using (public.is_office_staff());

    -- job_work_participants: select -> viewer
    create policy "Office staff view job work participants" on public.job_work_participants for select to authenticated using (public.is_office_viewer());

    -- price_categories: company slug stays admin-only
    create policy "Office staff can view price categories" on public.price_categories for select to authenticated
      using (public.is_admin() or (public.is_office_viewer() and slug <> 'company'));

    -- calendar_reminders: supervisor OR auditor (admin intentionally excluded)
    create policy "Active supervisors can view calendar reminders" on public.calendar_reminders for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('supervisor', 'auditor') and p.is_active));

    -- representative write RPC gated by is_office_staff
    create function public.set_job_comment(p_job_id uuid, p_comment text) returns void
    language plpgsql security definer set search_path = '' as $$
    begin
      if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
      update public.jobs set comments = p_comment where id = p_job_id;
    end
    $$;
    grant execute on function public.set_job_comment(uuid, text) to authenticated;
  `);

  await db.query(`insert into public.profiles (id, role, is_active, full_name, email) values
    ($1, 'admin', true, 'Admin', 'admin@example.test'),
    ($2, 'supervisor', true, 'Supervisor', 'supervisor@example.test'),
    ($3, 'auditor', true, 'Auditor', 'auditor@example.test'),
    ($4, 'auditor', false, 'Inactive Auditor', 'inactive-auditor@example.test'),
    ($5, 'tecnico', true, 'Technician', 'tecnico@example.test'),
    ($6, 'tecnico', true, 'Outsider', 'outsider@example.test')`,
    [admin, supervisor, auditor, inactiveAuditor, tecnico, outsider]);
  await db.query(`insert into public.jobs values ($1, 'Job', null, 'asignado')`, [job]);
  await db.query(`insert into public.manual_jobs values ($1, 'MAN-1', 10000, 'pending', $2)`, [manualJob, tecnico]);
  await db.query(`insert into public.manual_job_workers values ($1, $2, 5000)`, [manualJob, tecnico]);
  await db.query(`insert into public.fleet_vehicles (id, unit_number) values ($1, 'TRK-1')`, [vehicle]);
  await db.query(`insert into public.fleet_vehicle_assignments (vehicle_id, technician_id, assignment_role, starts_on, ends_on)
    values ($1, $2, 'primary', current_date - 1, null)`, [vehicle, tecnico]);
  await db.query(`insert into public.job_assignments values ($1, $2, 'technician', $3, null, true)`, [id(301), job, tecnico]);
  await db.query(`insert into public.job_work_participants values ($1, $2, 2500)`, [wpJob, tecnico]);
  await db.query(`insert into public.price_categories values ($1, 'company', 'Company', true), ($2, 'inhouse', 'In-house', true)`, [companyCategory, inhouseCategory]);
  await db.query(`insert into public.calendar_reminders values ($1, 'Reminder', $2)`, [id(401), admin]);

  // 1. Predicate semantics.
  const viewerOf = async (actor) => (await as(actor, "select public.is_office_viewer($1) as allowed", [actor])).rows[0].allowed;
  const staffOf = async (actor) => (await as(actor, "select public.is_office_staff($1) as allowed", [actor])).rows[0].allowed;
  eq(await viewerOf(admin), true, "admin is an office viewer");
  eq(await viewerOf(supervisor), true, "supervisor is an office viewer");
  eq(await viewerOf(auditor), true, "active auditor is an office viewer");
  eq(await viewerOf(inactiveAuditor), false, "inactive auditor is not an office viewer");
  eq(await viewerOf(tecnico), false, "technician is not an office viewer");
  eq(await staffOf(admin), true, "admin is office staff");
  eq(await staffOf(supervisor), true, "supervisor is office staff");
  eq(await staffOf(auditor), false, "CRITICAL: auditor is NOT office staff");
  eq(await staffOf(inactiveAuditor), false, "inactive auditor is not office staff");

  // 2. is_office_viewer must be security definer with an empty search_path.
  const viewerMeta = (await db.query(`select prosecdef, provolatile, proconfig from pg_proc where oid = 'public.is_office_viewer(uuid)'::regprocedure`)).rows[0];
  eq([viewerMeta.prosecdef, viewerMeta.provolatile, viewerMeta.proconfig], [true, "s", ['search_path=""']], "is_office_viewer is security definer, stable, safe search_path");
  eq((await db.query(`select has_function_privilege('public', 'public.is_office_viewer(uuid)', 'EXECUTE') as p, has_function_privilege('authenticated', 'public.is_office_viewer(uuid)', 'EXECUTE') as a`)).rows[0], { p: false, a: true }, "is_office_viewer execute is authenticated-only");

  // 3. Read split: auditor can SELECT across surfaces.
  eq((await as(auditor, "select id from public.jobs")).rows.map((r) => r.id), [job], "auditor can SELECT jobs");
  eq((await as(auditor, "select id from public.manual_jobs")).rows.map((r) => r.id), [manualJob], "auditor can SELECT manual_jobs");
  eq((await as(auditor, "select id from public.fleet_vehicles")).rows.map((r) => r.id), [vehicle], "auditor can SELECT fleet");
  eq((await as(auditor, "select job_id from public.job_work_participants")).rows.map((r) => r.job_id), [wpJob], "auditor can SELECT job_work_participants");
  eq((await as(auditor, "select id from public.price_categories where slug <> 'company'")).rows.map((r) => r.id), [inhouseCategory], "auditor can SELECT non-company price categories");
  eq((await as(auditor, "select id from public.price_categories where slug = 'company'")).rows.map((r) => r.id), [], "auditor cannot SELECT company price category");
  eq((await as(auditor, "select id from public.calendar_reminders")).rows.map((r) => r.id), [id(401)], "auditor can SELECT calendar reminders");

  // 4. Write split: auditor cannot mutate.
  await denied(() => as(auditor, "insert into public.jobs (id, title) values ($1, 'x')", [id(501)]), /permission denied|row-level security/u, "auditor cannot INSERT jobs");
  // UPDATE/DELETE are gated by an RLS `using (is_office_staff())` clause, which
  // silently filters rows instead of raising; the auditor must affect 0 rows.
  eq((await as(auditor, "update public.jobs set comments = 'x' where id = $1 returning id", [job])).rows.length, 0, "auditor cannot UPDATE jobs (0 rows affected)");
  eq((await as(auditor, "delete from public.jobs where id = $1 returning id", [job])).rows.length, 0, "auditor cannot DELETE jobs (0 rows affected)");
  await denied(() => as(auditor, "insert into public.fleet_vehicles (id, unit_number) values ($1, 'x')", [id(502)]), /permission denied|row-level security/u, "auditor cannot INSERT fleet");
  await denied(() => as(auditor, "insert into public.job_assignments (id, job_id, assignee_type, technician_id) values ($1, $2, 'technician', $3)", [id(503), job, tecnico]), /permission denied|row-level security/u, "auditor cannot INSERT job_assignments");
  await denied(() => as(auditor, "select public.set_job_comment($1, 'x')", [job]), /Office access required/u, "auditor cannot execute a staff-gated write RPC");

  // 5. Supervisor still mutates, and passes the write RPC.
  await as(supervisor, "select public.set_job_comment($1, 'ok')", [job]);
  eq((await as(admin, "select comments from public.jobs where id = $1", [job])).rows[0].comments, "ok", "supervisor can execute the staff-gated write RPC");

  // 6. Engine-hour policy boundary: active office staff and an assigned active
  // technician retain INSERT access; an active auditor can only read.
  const insertEngineHours = (actor, readingHours, source) => as(
    actor,
    "insert into public.fleet_engine_hour_readings (vehicle_id, reading_hours, source) values ($1, $2, $3) returning id",
    [vehicle, readingHours, source],
  );
  const adminReading = await insertEngineHours(admin, 100, "manual");
  ok(Boolean(adminReading.rows[0]?.id), "active admin can record engine hours");
  const supervisorReading = await insertEngineHours(supervisor, 110, "manual");
  ok(Boolean(supervisorReading.rows[0]?.id), "active supervisor can record engine hours");
  const technicianReading = await insertEngineHours(tecnico, 120, "technician");
  ok(Boolean(technicianReading.rows[0]?.id), "assigned active technician can record engine hours");

  eq(
    (await as(auditor, "select reading_hours from public.fleet_engine_hour_readings order by reading_hours")).rows.map((row) => Number(row.reading_hours)),
    [100, 110, 120],
    "active auditor can SELECT engine-hour history",
  );
  eq(
    (await as(inactiveAuditor, "select id from public.fleet_engine_hour_readings")).rows,
    [],
    "inactive auditor cannot SELECT engine-hour history",
  );
  await denied(
    () => insertEngineHours(auditor, 130, "manual"),
    /permission denied|row-level security/u,
    "auditor cannot INSERT engine-hour history",
  );
  await denied(
    () => as(auditor, "update public.fleet_engine_hour_readings set notes = 'x' where reading_hours = 100"),
    /permission denied|row-level security/u,
    "auditor cannot UPDATE engine-hour history",
  );
  await denied(
    () => as(auditor, "delete from public.fleet_engine_hour_readings where reading_hours = 100"),
    /permission denied|row-level security/u,
    "auditor cannot DELETE engine-hour history",
  );

  console.log(`PASS auditor role SQL: ${checks} checks; real is_office_viewer + policy split in disposable in-memory PGlite only`);
} finally {
  await db.close();
}
