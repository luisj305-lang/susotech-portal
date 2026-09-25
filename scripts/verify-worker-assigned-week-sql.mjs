import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Supply an already-installed PGlite entry; no installation, network or real DB.
// --legacy intentionally fails week-only expectations against the original RPC.
if (!process.argv[2]) throw new Error("Pass a local @electric-sql/pglite/dist/index.js path");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const legacy = process.argv.includes("--legacy");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(900), worker = id(901), other = id(902), member = id(903);
const start = "2026-09-11T00:00:00-04:00", end = "2026-09-18T00:00:00-04:00";
const previous = "2026-09-04T00:00:00-04:00";
const read = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const rejected = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
try {
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create table public.profiles(id uuid primary key, role text, is_active boolean);
    create table public.jobs (
      id uuid primary key, prism_number text, title text, address text, main_status text,
      deadline_date timestamptz, updated_at timestamptz, archived_at timestamptz,
      assignment_date timestamptz, created_at timestamptz, credited_at timestamptz, confirmed_at timestamptz
    );
    create table public.job_assignments (
      job_id uuid, assignee_type text, technician_id uuid, crew_id uuid,
      assigned_at timestamptz, active boolean default true, is_primary boolean default true
    );
    create unique index active_primary on public.job_assignments(job_id) where active and is_primary;
    create table public.crews(id uuid primary key, lead_technician_id uuid, is_active boolean);
    create table public.crew_members(crew_id uuid, technician_id uuid);
    create table public.job_financial_allocations(job_id uuid, participant_id uuid);
    grant usage on schema public, auth to authenticated, anon;
    insert into public.profiles values ('${actor}', 'admin', true);
  `);
  const office = (await read("20260810001000_jobs_module.sql"))
    .match(/create or replace function public\.is_office_staff[\s\S]*?grant execute on function public\.is_office_staff\(uuid\) to authenticated;/u)?.[0];
  assert.ok(office);
  await db.exec(office);
  await db.exec(await read("20260818040000_fix_technician_jobs_deadline_type.sql"));
  if (!legacy) {
    // Supabase installations may grant anon EXECUTE through default privileges.
    await db.exec("alter default privileges in schema public grant execute on functions to anon");
    await db.exec(await read("20260915020000_worker_assigned_week_drilldown.sql"));
  }
  await db.query("select set_config('test.actor', $1, false)", [actor]);
  const add = async (n, assignedAt, technician = worker, options = {}) => {
    await db.query(`insert into public.jobs values ($1, $2, $2, $2, 'asignado', $3, $3,
      $4::timestamptz, $3, $3, $3, $3)`, [id(n), `Synthetic ${n}`, end, options.archived ? end : null]);
    await db.query(`insert into public.job_assignments values ($1, $2, $3, $4, $5, $6, $7)`,
      [id(n), options.crew ? "crew" : "technician", options.crew ? null : technician,
        options.crew ?? null, assignedAt, options.active ?? true, options.primary ?? true]);
  };
  const invoke = async (tech = worker, from = start, to = end, oldSignature = legacy) => {
    await db.exec("set role authenticated");
    try {
      return (await db.query(oldSignature
        ? "select * from public.list_technician_assigned_jobs(p_technician_id => $1::uuid)"
        : `select * from public.list_technician_assigned_jobs(p_technician_id => $1::uuid,
            p_week_start_at => $2::timestamptz, p_week_end_exclusive_at => $3::timestamptz)`,
      oldSignature ? [tech] : [tech, from, to])).rows;
    } finally { await db.exec("reset role"); }
  };
  const ids = (rows) => rows.map((row) => row.id).sort();
  const expectedIds = (...numbers) => numbers.map(id).sort();
  await add(1, start);
  await add(2, "2026-09-11T03:59:59.999999Z");
  await add(3, end);
  await add(4, "2026-09-18T03:59:59.999999Z", worker, { archived: true });
  await add(5, previous);
  await add(6, start, other);
  await add(7, start, other);
  await db.query("insert into public.job_financial_allocations values ($1,$2)", [id(7), worker]);
  await add(8, start, worker, { active: false });
  await add(9, start, worker, { primary: false });
  await add(10, previous);
  await db.query("insert into public.job_assignments values ($1,'technician',$2,null,$3,false,true)", [id(10), other, start]);
  await db.query("insert into public.crews values ($1,$2,true), ($3,$2,false), ($4,$5,true)",
    [id(801), worker, id(802), id(803), other]);
  await db.query("insert into public.crew_members values ($1,$2), ($3,$4)", [id(801), member, id(803), worker]);
  await add(11, start, null, { crew: id(801) });
  await add(12, start, null, { crew: id(802) });
  await add(13, start, null, { crew: id(803) });

  eq(ids(await invoke()), expectedIds(1, 4, 11, 13), "Selected worker/current week only (including archived and legacy crew associations)");
  eq(ids(await invoke(worker, previous, start)), expectedIds(2, 5, 10), "Previous week; another worker's assignment timestamp must not qualify the job");
  eq(ids(await invoke(other)), expectedIds(6, 7, 13), "Other worker and crew lead; no financial-only participation");
  eq(ids(await invoke(member)), expectedIds(11), "Existing active crew member association preserved");
  eq(ids(await invoke(worker, "2026-08-28T00:00:00-04:00", previous)), [], "Empty week");
  eq(ids(await invoke(worker, start, end, true)), expectedIds(1, 2, 3, 4, 5, 10, 11, 13), "Unchanged one-argument legacy RPC still resolves unambiguously");
  await db.query("update public.jobs set updated_at=$1 where id=$2", [start, id(4)]);
  eq((await invoke()).at(-1).id, id(4), "Existing updated_at descending display order preserved");
  const signatures = (await db.query(`select pronargs, pronargdefaults, prosecdef, provolatile, proconfig
    from pg_proc where oid in ('public.list_technician_assigned_jobs(uuid)'::regprocedure,
      'public.list_technician_assigned_jobs(uuid,timestamptz,timestamptz)'::regprocedure) order by pronargs`)).rows;
  eq(signatures.map((row) => [row.pronargs, row.pronargdefaults, row.prosecdef, row.provolatile]),
    [[1, 0, true, "s"], [3, 0, true, "s"]], "No optional/default overload ambiguity; stable security-definer contracts");
  eq(signatures[1].proconfig, ['search_path=""'], "Fixed empty search_path");
  eq(Object.keys((await invoke())[0]), ["id", "prism_number", "title", "address", "main_status", "deadline_date", "updated_at", "archived_at"], "Return shape unchanged");

  for (const [from, to, hours] of [
    ["2026-03-06T00:00:00-05:00", "2026-03-13T00:00:00-04:00", 167],
    ["2026-10-30T00:00:00-04:00", "2026-11-06T00:00:00-05:00", 169],
    ["2025-12-26T00:00:00-05:00", "2026-01-02T00:00:00-05:00", 168],
  ]) {
    await db.exec("delete from public.job_assignments; delete from public.jobs");
    for (const n of [1, 2, 3, 4]) await add(n, from);
    await db.query(`update public.job_assignments set assigned_at = case job_id
      when $1 then $5::timestamptz - interval '1 microsecond'
      when $2 then $5::timestamptz
      when $3 then $6::timestamptz - interval '1 microsecond'
      when $4 then $6::timestamptz end`, [id(1), id(2), id(3), id(4), from, to]);
    eq((Date.parse(to) - Date.parse(from)) / 3600000, hours, "DST/year fixture duration");
    for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      await db.query("select set_config('TimeZone', $1, false)", [timezone]);
      eq(ids(await invoke(worker, from, to)), expectedIds(2, 3), `Half-open New York week independent of session timezone ${timezone}`);
    }
  }
  await db.exec("set time zone 'UTC'");
  for (const [from, to] of [[null, end], [start, null], [end, start], [start, "infinity"],
    ["-infinity", end], ["2026-09-11", "2026-09-18"], [start, "2026-09-25T00:00:00-04:00"],
    ["2026-09-11T01:00:00-04:00", end]]) {
    await rejected(() => invoke(worker, from, to), /Invalid worker assignment week/u);
  }
  await rejected(() => invoke(null), /Invalid worker assignment week/u);
  for (const [role, active, allowed] of [["supervisor", true, true], ["tecnico", true, false], ["admin", false, false]]) {
    await db.query("update public.profiles set role=$1, is_active=$2", [role, active]);
    if (allowed) { await invoke(); checks++; }
    else await rejected(() => invoke(), /Office access required/u);
  }
  await db.query("select set_config('test.actor', '', false)");
  await rejected(() => invoke(), /Office access required/u);
  await db.exec("set role anon");
  await rejected(() => db.query("select * from public.list_technician_assigned_jobs($1,$2,$3)", [worker, start, end]), /permission denied/u);
  await db.exec("reset role");
  eq((await db.query(`select has_function_privilege('anon', 'public.list_technician_assigned_jobs(uuid,timestamptz,timestamptz)', 'EXECUTE') as allowed`)).rows[0].allowed,
    false, "Anonymous callers have no execute privilege");
  console.log(`PASS worker assigned-week SQL: ${checks} checks; real PostgreSQL functions in disposable in-memory PGlite only`);
} finally { await db.close(); }
