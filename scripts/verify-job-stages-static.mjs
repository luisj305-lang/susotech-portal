import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260823004000_job_billable_stages.sql", "utf8");
const actions = await readFile("src/lib/jobs/stage-actions.ts", "utf8");
const component = await readFile("src/components/jobs/job-stages-manager.tsx", "utf8");
const queries = await readFile("src/lib/jobs/queries.ts", "utf8");
const page = await readFile("app/trabajos/[id]/page.tsx", "utf8");

const checks = [
  [migration.includes("create table public.job_stages"), "creates the stage table"],
  [migration.includes("unique (job_id, sequence)"), "orders stages independently per job"],
  [migration.includes("create table public.job_stage_events"), "creates append-only stage audit"],
  [migration.includes("revoke insert, update, delete on table public.job_stage_events"), "protects audit rows"],
  [migration.includes("Invalid job stage transition"), "enforces linear stage transitions in the database"],
  [migration.includes("where j.id = job_id and j.archived_at is null"), "blocks stage mutations for archived jobs"],
  [migration.includes("j.main_status in ('facturado', 'pagado')"), "backfills legacy invoices"],
  [actions.includes("export async function createJobStage"), "exposes stage creation"],
  [actions.includes(".eq(\"status\", \"pending\")"), "completes only pending stages"],
  [actions.includes(".eq(\"status\", \"completed\")"), "invoices only completed stages"],
  [actions.includes(".eq(\"status\", \"invoiced\")"), "pays only invoiced stages"],
  [component.includes("Completar o pagar una etapa no cierra el trabajo"), "explains independent lifecycle"],
  [queries.includes('supabase.from("job_stages")'), "loads stages in office detail"],
  [queries.includes('supabase.from("job_stage_events")'), "loads stage audit in office detail"],
  [page.includes("<JobStagesManager"), "renders the manager in the current job detail"],
];

for (const [passed, message] of checks) {
  if (!passed) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}
