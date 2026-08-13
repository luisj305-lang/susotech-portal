import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const primitives = read("supabase/migrations/20260813010000_technician_shift_primitives.sql");
const enforcement = read("supabase/migrations/20260813020000_enforce_active_technician_shifts.sql");
const fuelUploadFix = read("supabase/migrations/20260813021000_fix_shift_fuel_signed_upload.sql");
const access = read("src/lib/work-shifts/access.ts");
const types = read("src/lib/work-shifts/types.ts");
const actions = read("src/lib/work-shifts/actions.ts");
const form = read("src/components/work-shifts/start-shift-form.tsx");
const proxy = read("proxy.ts");
const editor = read("src/components/jobs/pdf-code-editor.tsx");
const jobActions = read("src/lib/jobs/actions.ts");
const storageActions = read("src/lib/storage/actions.ts");
const deliveredRoute = read("app/api/trabajos/[id]/pdf-entregado/route.ts");
const previewRoute = read("app/api/trabajos/[id]/pdf-original-preview/route.ts");

const exactMessage = "Tu jornada de trabajo terminó. Inicia una nueva jornada para continuar.";
let checks = 0;
const matches = (source, pattern, label) => {
  assert.match(source, pattern, label);
  checks += 1;
};
const omits = (source, pattern, label) => {
  assert.doesNotMatch(source, pattern, label);
  checks += 1;
};

matches(primitives, /create table if not exists public\.technician_shifts/u, "shift table exists");
matches(primitives, /fuel_amount numeric\(12,2\) not null/u, "fuel uses fixed decimal storage");
matches(primitives, /active_until = started_at \+ interval '10 hours'/u, "shift duration is exactly ten hours");
matches(primitives, /exclude using gist[\s\S]*tstzrange\(started_at, active_until, '\[\)'\) with &&/u, "overlapping shifts are excluded");
matches(primitives, /p_fuel_amount <> round\(p_fuel_amount, 2\)/u, "fuel rejects more than two decimals");
matches(primitives, /p_no_fuel_today and \(p_fuel_amount <> 0 or clean_photo_path is not null\)/u, "no-fuel state is explicit");
matches(primitives, /not p_no_fuel_today and p_fuel_amount <= 0/u, "fuel purchase requires a positive amount");
matches(primitives, /\(not no_fuel_today and fuel_amount > 0\)/u, "fuel purchase permits a null optional photo");
matches(primitives, /values \('technician-shift-fuel', 'technician-shift-fuel', false\)/u, "fuel bucket is private");
matches(primitives, /pg_advisory_xact_lock/u, "shift start serializes concurrent requests");
matches(primitives, /An active shift already exists/u, "duplicate active shift has a stable database error");
matches(primitives, /security definer\s+set search_path = ''/u, "shift RPCs fix search_path");
matches(fuelUploadFix, /file_size_limit = 10485760/u, "fuel bucket enforces the ten-megabyte limit");
matches(fuelUploadFix, /allowed_mime_types = array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]/u, "fuel bucket enforces image MIME types");
matches(fuelUploadFix, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/u, "signed fuel uploads stay inside the technician path");
omits(fuelUploadFix, /metadata\s*->>/u, "signed-upload policy does not require unavailable object metadata");
matches(storageActions, /new Date\(access\.shift!\.server_now\)[\s\S]*expiresIn = Math\.min\(expiresIn, remaining\)/u, "technician download TTL is bounded by database shift time");
matches(form, /const \[amount, setAmount\] = useState\(""\)/u, "fuel money remains a string in client state");
matches(form, /moneyPattern[\s\S]*\\d\{1,2\}/u, "fuel input accepts at most two decimals");
matches(form, /type="file"[\s\S]*capture="environment"/u, "shift form exposes the device camera");
matches(form, /Elegir de galería[\s\S]*type="file"/u, "shift form exposes gallery selection");
matches(actions, /fuelAmount: string/u, "server action receives decimal money as a string");
matches(actions, /rpc\("start_technician_shift"/u, "server action delegates decimal validation to the database RPC");

matches(enforcement, /create or replace function public\.has_active_technician_shift/u, "active-shift predicate exists");
matches(enforcement, /clock_timestamp\(\) as checked_at/u, "authorization uses the database clock");
matches(enforcement, /s\.started_at <= checked\.checked_at[\s\S]*s\.active_until > checked\.checked_at/u, "active interval is half-open");
matches(enforcement, new RegExp(exactMessage.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), "database exposes the exact expiration message");
matches(enforcement, /if public\.is_office_staff\(check_user_id\) then return true; end if;/u, "office access bypasses technician shifts");
matches(enforcement, /perform public\.require_active_technician_shift\(check_user_id\);/u, "job authorization requires an active shift");
matches(enforcement, /public\.has_active_technician_shift\(\)[\s\S]*assignee_type = 'technician'[\s\S]*public\.can_access_crew/u, "assignment RLS covers individual and crew assignments");

for (const trigger of [
  "guard_active_shift_job_update_before_update",
  "guard_active_shift_production_before_write",
  "guard_active_shift_draft_before_write",
  "guard_active_shift_photo_before_write",
]) {
  matches(enforcement, new RegExp(`create trigger ${trigger}`, "u"), `${trigger} exists`);
}

for (const rpc of [
  "add_job_production",
  "initialize_job_pdf_draft",
  "save_job_pdf_draft",
  "confirm_delivered_job_pdf",
  "confirm_delivered_job_pdf_versioned",
]) {
  const start = enforcement.indexOf(`create or replace function public.${rpc}`);
  assert.notEqual(start, -1, `${rpc} exists in shift enforcement migration`);
  const next = enforcement.indexOf("create or replace function public.", start + 1);
  const body = enforcement.slice(start, next === -1 ? undefined : next);
  matches(body, /perform public\.require_active_technician_shift\(actor\);/u, `${rpc} enforces the shift inside the database transaction`);
}

omits(enforcement, /grant execute on function public\.require_active_technician_shift/u, "internal guard is not callable by authenticated clients");
assert.equal(types.includes(exactMessage), true, "client and database use the same exact message");
checks += 1;
matches(access, /get_my_active_shift/u, "server access helper reads the authoritative shift");
matches(jobActions, /requireTechnicianShift/u, "job actions guard technician mutations");
matches(storageActions, /requireTechnicianShift/u, "Storage actions guard technician operations");
matches(deliveredRoute, /getWorkShiftAccessForActor/u, "delivered PDF route guards active shifts");
matches(previewRoute, /getWorkShiftAccessForActor/u, "PDF preview route guards active shifts");
omits(proxy, /work-shifts|work_shift|jornada|get_my_active_shift|has_active_technician_shift/u, "Proxy performs no shift lookup");
matches(editor, /if \(!response\.ok\) \{[\s\S]*await response\.text\(\)[\s\S]*throw new Error\(message/u, "editor propagates the preview 403 response body");

console.log(`PASS work-shift static checks=${checks}`);
