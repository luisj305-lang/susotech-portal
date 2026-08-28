# Proposal: Multi-Part Jobs

## Intent

Jobs are one-shot: once delivered and paid, nothing more can happen. Some jobs have multiple parts, each needing its own invoicing. Allow a job to gain additional independently-managed parts sharing the same client/address/PRISM.

## Scope

### In Scope
- New nullable `jobs.parent_job_id` (self-FK) + cycle/self-parent guard migration.
- "Agregar otra parte" server RPC that clones parent client/address/PRISM into a new `sin_asignar` child, mirroring `assign_jobs_atomic` (`set_config('app.job_assignment_mutation')` + deferred trigger).
- Parent/child grouping in `listOfficeJobs`/`listTechnicianJobs`; children excluded from flat double-count.
- Archive/delete cascade semantics for `parent_job_id`.

### Out of Scope
- Nesting deeper than one parent → children.
- Parallel billing pipeline (each part reuses the existing invoice machine).
- Retiring the orphaned `job_stages` feature (deferred).

## Capabilities

### New Capabilities
- `multi-part-jobs`: parent/child job relationship, create-part RPC, grouping, and aggregation rules.

### Modified Capabilities
- `job-lifecycle`: child-job creation, parent/child editing, archive/delete cascade semantics.
- `job-invoicing`: each part invoices separately; children (not the parent umbrella) are the countable units in `get_weekly_invoiced_total` and reports.

## Approach

Each part is a child `jobs` row (nullable `parent_job_id`) reusing the entire existing machine — assignment, delivery, reparto, invoice, archive, RLS, storage — all `job_id`-scoped. "Agregar otra parte" clones shared fields in one transaction. RLS/auth follow `docs/04-SEGURIDAD.md`; architecture per `docs/01-ARQUITECTURA.md`.

## Open Decision Points

1. **Field denormalization**: parent holds shared client/address/PRISM, children copy them, or children re-read from parent?
2. **Technician parent visibility**: `can_access_job` is per-job; read-only parent visibility vs denormalizing client/address onto child.
3. **Cycle guard**: self-parent reject + depth limit on `parent_job_id`.
4. **Archive/delete cascade**: `on delete` policy for `parent_job_id`; archiving a parent with open parts.
5. **List/aggregation dedup**: children must not double-count in `listOfficeJobs`, `get_weekly_invoiced_total`, financial/production reports.
6. **`job_stages` disposition**: retire vs leave dormant.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/*jobs*.sql` | Modified | `parent_job_id` + guard; create-part RPC |
| `src/lib/jobs/queries.ts` | Modified | grouping/dedup in lists + totals |
| `src/lib/jobs/actions.ts`, `types.ts` | Modified | create-part action, types |
| `app/trabajos/**`, `src/components/jobs/job-list.tsx` | Modified | grouping UI |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Technician can't see parent client/address | High | Resolve decision #2 before design |
| Children double-count in reports | Med | Dedup; count children as units |
| Cycle/self-parent | Med | DB guard + depth limit |
| Archive cascade surprises | Med | Explicit `on delete` policy |

## Rollback Plan

`parent_job_id` is additive and nullable; existing rows untouched. Rollback drops the column + RPC; UI falls back to flat list. No data migration required to revert.

## Dependencies

- `assign_jobs_atomic` + `set_config('app.job_assignment_mutation')` deferred-trigger pattern (exists).

## Success Criteria

- [ ] Office adds a second part to any job at any time; new part starts `sin_asignar`, sharing client/address/PRISM.
- [ ] Each part invoices and pays independently.
- [ ] Part 1 can be invoiced-unpaid while part 2 is in progress.
- [ ] Children never double-count in lists or totals.
