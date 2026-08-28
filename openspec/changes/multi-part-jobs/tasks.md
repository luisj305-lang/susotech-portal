# Tasks: Multi-Part Jobs

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~420–480 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full change (DB + lib + UI) | Single PR | `npm run lint` && `npm run build` | N/A — no test runner; verify via SQL assertions + manual UI | `git revert` single PR; drop migration + RPC |

## Phase 1: Database

- [x] 1.1 Create `supabase/migrations/20260828000000_job_parts.sql`: `alter table public.jobs add column parent_job_id uuid`; FK `jobs_parent_job_id_fkey` → `jobs(id) on delete restrict`; index `jobs_parent_job_id_idx`.
- [x] 1.2 Add CHECK `jobs_no_self_parent_check` (`parent_job_id is null or parent_job_id <> id`). Rejects spec `multi-part-jobs`: Auto-padre rechazado.
- [x] 1.3 Create `validate_job_parent_hierarchy()`: reject non-root parent; reject "job with parts becomes a part"; reject UPDATE changing `parent_job_id` (immutable — no re-parent, no root→part). Attach trigger `before insert or update of parent_job_id`.
- [x] 1.4 Create `create_job_part(p_parent_job_id uuid)` RPC: office-staff gate, `for update` root, reject missing/archived/child parent, `set_config('app.job_assignment_mutation')`, clone `title, prism_number, address, customer_name, category, location, job_type` (7 fields), `main_status='sin_asignar'`. Revoke public, grant authenticated.

## Phase 2: Domain Library

- [x] 2.1 `src/lib/jobs/types.ts`: add `parent_job_id: string | null` to `Job`; add `partLabel: string | null`; add `JobPartGroup` interface.
- [x] 2.2 `src/lib/jobs/parts.ts`: `partLabel(job, children)` (root+children → "Parte 1"; child → "Parte 2..N" by `created_at`; standalone → null) and `groupJobParts(jobs)` returning root-first groups.
- [x] 2.3 `src/lib/jobs/actions.ts`: `createJobPart({ jobId }): Promise<Result<{ id: string }>>` calling RPC then `revalidatePath("/trabajos")` + `refresh(jobId)`; map FK/archived/child errors to Spanish messages.
- [x] 2.4 `src/lib/jobs/queries.ts`: group children under roots in `listOfficeJobs`/`listTechnicianJobs` (no flat double-count); `getOfficeJob` returns sibling parts + root.

## Phase 3: UI Wiring

- [x] 3.1 `src/components/jobs/part-actions.tsx` (client): "Agregar otra parte" button + parts list with "Parte N" labels; success → `router.refresh()`.
- [x] 3.2 `app/trabajos/[id]/page.tsx`: render `part-actions` + part context only when office role, non-archived, root-only (`job.parent_job_id === null`).
- [x] 3.3 `src/components/jobs/job-list.tsx`: render `groupJobParts` output; "Parte N" chip; standalone root no chip.
- [x] 3.4 `app/trabajos/page.tsx`: pass grouped jobs to `JobList` for the office list.

## Phase 4: Verification

- [x] 4.1 `npm run lint` && `npm run build` green.
- [x] 4.2 SQL assertions (scratch env): self-parent rejected; child-as-parent rejected; UPDATE `parent_job_id` rejected; delete root with children rejected; `create_job_part` clones 7 fields; non-office/archived/child rejected. (Documented but UNEXECUTED — no local Supabase stack / supabase CLI / psql / docker.)
- [x] 4.3 Verify invoicing dedup: root + 2 children `pagado` → `get_weekly_invoiced_total` counts 3 (`job-invoicing`: Deduplicación en totales). (Documented but UNEXECUTED — no local Supabase stack / supabase CLI / psql / docker.)
