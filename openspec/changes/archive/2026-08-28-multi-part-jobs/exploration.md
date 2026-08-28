# Exploration: multi-part-jobs

## Current State

A job in susotech-portal is a single one-shot work unit. The `jobs` table (`supabase/migrations/20260810001000_jobs_module.sql`) plus ~100 later migrations implement a full pipeline: assignment → delivery (PDF + annotations + production lines) → financial split (reparto) → invoice → payment → archive. There is no parent/child relationship today (grep for `parent_job_id` returns nothing).

The current effective state machine (verified) is `sin_asignar → asignado → en_revision → aprobado → facturado → pagado`. The `public.job_status` enum still *contains* legacy labels (`en_progreso`, `enviado_revision`, `listo_pagar`) because Postgres cannot drop enum values, but the effective `validate_job_update()` trigger (`20260817012000_job_state_machine_and_permissions.sql`) only accepts the current labels; the legacy labels were migrated/backfilled away (`20260813032000`, `20260813050000`, `20260817011000`). `main_status` default is `sin_asignar` (`20260813034000`).

**Effective transitions** (source: `validate_job_update`, `20260817012000`):
- Office: `asignado → en_revision`, `en_revision → aprobado|asignado`, `aprobado → facturado`, `facturado → pagado`.
- `en_revision → asignado` (return for correction) requires a non-empty `comments` reason.
- `aprobado → facturado` requires a non-empty `invoice_number`.
- `pagado` freezes `invoice_number`/`invoice_path`.
- Technician delivers ONLY through the delivery RPC (`confirm_delivered_job_pdf_with_allocations`), which moves `asignado → en_revision`; technicians cannot drive office transitions directly.
- Assignment coherence (`sin_asignar ↔ asignado`) is owned by the deferred constraint trigger `enforce_job_assignment_status_on_jobs` plus the `app.job_assignment_mutation` `set_config` capability token, via `assign_jobs_atomic` / `confirm_job_import_item`.

The recommended approach — **each "part" is a child `job` row linked by a new nullable `parent_job_id`, reusing the entire existing job machine** — is highly feasible because every "one-of" invariant is scoped to `job_id`, not to a client/PRISM.

## Affected Areas

- `supabase/migrations/20260810001000_jobs_module.sql` — `jobs` table + `job_assignments` + `can_access_job` origin; assignment/status trigger machinery.
- `supabase/migrations/20260813034000_enforce_assignment_status_coherence.sql` — deferred coherence trigger + `assign_jobs_atomic` (the pattern any "create part" RPC must mirror).
- `supabase/migrations/20260817012000_job_state_machine_and_permissions.sql` — current `validate_job_update` machine + `set_config` capability-token pattern.
- `supabase/migrations/20260813012000_job_delivery_audit_primitives.sql` — `job_deliveries` + unique index `job_deliveries_current_submission_idx (job_id) WHERE submitted AND superseded_at IS NULL`.
- `supabase/migrations/20260813040000_delivery_financial_allocations.sql` — reparto keyed to `delivery_id` (one current version per delivery).
- `supabase/migrations/20260823004000_job_billable_stages.sql` — BILLING-ONLY `job_stages`/`job_stage_events` (NOT full work units); orphaned.
- `supabase/migrations/202608110100_job_archival.sql` + `set_job_archived_v2` — `archived_at` semantics; `delete_archived_job` storage cleanup keyed to `<job-id>/%`.
- `src/lib/jobs/queries.ts` — `listOfficeJobs`/`listTechnicianJobs`/`getOfficeJob`/`getTechnicianJob`; list aggregation and detail rendering.
- `src/lib/jobs/actions.ts`, `src/lib/jobs/stage-actions.ts`, `src/lib/jobs/state.ts`, `src/lib/jobs/types.ts` — job CRUD, orphaned stage actions, transition helpers, types.
- `app/trabajos/page.tsx`, `app/trabajos/[id]/page.tsx`, `src/components/jobs/job-list.tsx` — list cards and detail rendering (grouping/dedup surfaces here).
- `src/components/jobs/job-stages-manager.tsx` — orphaned component (not imported anywhere; `queries.ts` never reads `job_stages`).

## Approaches

1. **Child jobs via nullable `parent_job_id` (recommended)** — each part is a full `jobs` row reusing the existing machine.
   - Pros: reuses assignment, delivery, reparto, invoice, archive, RLS, storage, and report machinery with zero new parallel tables; each part is independently assignable/deliverable/invoiceable/paid; the per-`job_id` unique indexes (current submission, active primary assignment, current allocation) apply naturally per part.
   - Cons: parent/child shared-field denormalization; list/aggregation must group children; RLS/technician read access for parent; cycle/depth guard; cascade-delete decision; overlap with orphaned `job_stages`.
   - Effort: Medium.

2. **Multiple deliveries/allocations on ONE job** — one `jobs` row with many `job_deliveries`/allocations.
   - Pros: no new parent/child concept; client/address/PRISM stay in one place.
   - Cons: directly violates `job_deliveries_current_submission_idx` (one submitted delivery per job), `job_assignments_one_active_primary_idx` (one primary assignment), the `sin_asignar↔asignado` coherence trigger, and `confirm_delivered_job_pdf_*` which assumes one current delivery; would require rewriting the delivery + allocation + assignment invariants.
   - Effort: High (destructive).

3. **Extend orphaned `job_stages` into full work units** — upgrade the billing-only `job_stages` table to carry assignment/delivery/reparto.
   - Pros: table already exists and is append-only-audited.
   - Cons: `job_stages` has no assignment/delivery/allocation columns and no RLS for technicians; turning it into a full work unit means rebuilding the delivery/allocation pipeline a second time; `JobStagesManager` is orphaned (zero UI wiring); the component is client-only and never mounted.
   - Effort: High.

## Recommendation

Approach 1 (child jobs via nullable `parent_job_id`). Every critical invariant is `job_id`-scoped, so each part becomes an ordinary job with its own assignment, one submitted delivery, one current financial allocation, and one invoice. The parent holds shared client/address/PRISM identity and acts as a grouping umbrella; the "Agregar otra parte" action is a server RPC that clones parent shared fields into a new `sin_asignar` (or optionally pre-assigned) child inside one transaction, mirroring `assign_jobs_atomic`'s `set_config('app.job_assignment_mutation', …)` + deferred-trigger pattern.

## Risks

- **Technician read access does not inherit**: `can_access_job`/`can_view_job`/`can_mutate_job` are strictly per-job via `job_assignments`. A technician on part 2 can see part 2 but not the parent (client/address). Decide whether to denormalize client/address onto each child, or grant read-only parent visibility via assignment/participant.
- **Cycle/self-parent**: `parent_job_id` self-FK needs a guard (self-parent reject; depth limit or ancestors-path check).
- **Archive/delete cascade semantics**: archiving/deleting a parent does not touch children; `delete_archived_job` cleans `<job-id>/%` storage per job. FK `on delete` for `parent_job_id` (restrict vs cascade vs set-null) must be explicit.
- **List/aggregation + double counting**: `listOfficeJobs` renders one card per job; child jobs would appear as flat duplicates. `get_weekly_invoiced_total` and financial/production reports must treat children (not the umbrella parent) as the countable units.
- **Overlap with orphaned `job_stages`**: decide whether to retire the billing-only stages feature or leave it dormant; a paid child part should not also appear as a manual "stage".
- **One-current-submission index is per `job_id`** — it does NOT block child jobs, but a misread ("parts = multiple deliveries on one job") would hit it. Design must keep one delivery per part.

## Ready for Proposal

Yes. Proceed to `sdd-propose` with: (1) nullable `parent_job_id` + cycle guard migration; (2) a "create part" RPC following the `assign_jobs_atomic` config-token + deferred-trigger pattern; (3) explicit decisions on parent-vs-child field denormalization and technician parent visibility; (4) archive/delete/aggregation semantics; (5) disposition of the orphaned `job_stages` feature.
