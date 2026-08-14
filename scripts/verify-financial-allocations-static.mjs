import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [ledger, access, backfill, helperCorrection, hardening, route, editor] = await Promise.all([
  read("supabase/migrations/20260813040000_delivery_financial_allocations.sql"),
  read("supabase/migrations/20260813041000_financial_allocation_reports_and_access.sql"),
  read("supabase/migrations/20260813045000_backfill_unambiguous_delivery_allocations.sql"),
  read("supabase/migrations/20260813047000_exclude_helpers_from_delivery_allocation_backfill.sql"),
  read("supabase/migrations/20260813048000_remove_allocation_temp_table.sql"),
  read("app/api/trabajos/[id]/pdf-entregado/route.ts"),
  read("src/components/jobs/pdf-code-editor.tsx"),
]);

for (const token of [
  "source_amount_cents bigint",
  "percentage_basis_points integer",
  "sum(amount_snapshot) * 100",
  "unique (delivery_id, idempotency_key)",
  "where superseded_at is null and voided_at is null",
  "sum(percentage_basis_points) from pg_temp.requested_delivery_allocations) <> 10000",
  "row_number() over (order by remainder desc, allocation_order, participant_id)",
  "revoke insert, update, delete on public.job_delivery_allocation_versions from authenticated",
  "confirm_delivered_job_pdf_with_allocations",
]) assert.ok(ledger.includes(token), `missing ledger invariant: ${token}`);

assert.ok(access.includes("a.participant_id = check_user_id"), "helper/participant own-read path missing");
assert.ok(access.includes("public.is_operational_worker(check_user_id)"), "mutation boundary must remain operational-only");
assert.ok(access.includes("get_my_weekly_financial_allocations"), "own weekly financial report missing");
assert.ok(route.includes("percentageBasisPoints") && route.includes(") === 10000"));
assert.ok(editor.includes("percentageBasisPoints, 0) !== 10000"));

for (const token of [
  "j.current_delivery_id = d.id",
  "not exists (",
  "count(l.id) filter (where l.amount_snapshot is null) = 0",
  "count(distinct l.credited_technician_id) = 1",
  "bool_and(l.credited_technician_id = d.delivered_by)",
  "(sum(l.amount_snapshot) * 100)::bigint",
  "percentageBasisPoints', 10000",
  "on conflict do nothing",
  "grant execute on function public.backfill_unambiguous_delivery_allocations() to service_role",
]) assert.ok(backfill.includes(token), `missing backfill invariant: ${token}`);
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(backfill), "backfill must not hardcode row IDs");
assert.ok(helperCorrection.includes("p.worker_specialty in ('tecnico', 'splicer', 'liner')"));
assert.ok(!helperCorrection.includes("p.worker_specialty in ('tecnico', 'splicer', 'liner', 'ayudante')"));
assert.ok(helperCorrection.includes("a.worker_specialty_snapshot = 'ayudante'"), "pending helper backfill rows must be corrected safely");
assert.ok(hardening.includes("unnest(requested_participant_ids, requested_basis_points)"), "latest allocation function must parse request arrays without relation state");
assert.ok(!hardening.includes("pg_temp") && !hardening.includes("create temporary table"), "latest allocation function must not depend on a temporary relation");

console.log("financial allocations static: PASS");
