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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Missing Supabase read-only report environment variables");

const client = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// This verifier intentionally performs SELECT requests only. It is safe to run
// against local or hosted environments and never changes crew history.
const { data, error } = await client
  .from("job_assignments")
  .select("id,active,is_primary,assigned_at,crew_id,jobs(id,prism_number,main_status,archived_at),crews(id,name)")
  .eq("assignee_type", "crew")
  .order("assigned_at", { ascending: true });

if (error) throw error;

const rows = data ?? [];
const active = rows.filter((row) => row.active).length;
const historical = rows.length - active;
const operationalStatuses = new Set(["en_progreso", "enviado_revision", "aprobado", "listo_pagar", "pagado"]);
const operational = rows.filter((row) => operationalStatuses.has(row.jobs?.main_status)).length;
const archived = rows.filter((row) => Boolean(row.jobs?.archived_at)).length;

const report = {
  total: rows.length,
  active,
  historical,
  operational,
  archived,
  assignments: rows.map((row) => ({
    assignment_id: row.id,
    job_id: row.jobs?.id ?? null,
    prism_number: row.jobs?.prism_number ?? null,
    job_status: row.jobs?.main_status ?? null,
    active: row.active,
    primary: row.is_primary,
    assigned_at: row.assigned_at,
    crew_id: row.crews?.id ?? row.crew_id,
    crew_name: row.crews?.name ?? null,
  })),
};

console.log(JSON.stringify(report, null, 2));
