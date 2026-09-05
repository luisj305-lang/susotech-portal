# Tasks: Portal Workflow Improvements

## Review Workload Forecast
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

`auto-chain`; ceiling 800; target ≤400/PR (not `size:exception`). Conditional additions+deletions: 3,230–5,260 plus R07 UNREPRODUCED/TBD; assumes narrow extensions including tests/docs/migrations. Re-estimate after gates; split >400.

#368/#358 govern sequential main-bound PRs, no tracker; earlier UNSELECTED snapshots are historical. Delivery resolved; PRODUCT approvals and implementation authorization remain required. PLAN ONLY.

Prospective implementation PRs include tests/docs: action; focused T; runtime scenario; rollback; estimate. `Tn` means proposed/unimplemented `node scripts/verify-workflow-n.mjs`; author/validate before use. `M(n)` means proposed `supabase/migrations/<timestamp>_workflow_<n>.sql`: additive readers-before-writers, not bundled design migration.

All start after scoped 1.1/1.2. Order: numbered; dependencies `gates→📍2.1;3.1→{3.2,3.3,3.4,3.5};1.3→4.3;5.1→5.2;6.2→6.3→6.4`. `5.2→6.2` only attendance coworkers. First boundary 📍2.1; R07 blocks nobody else.

Preserve accounting/audit/RLS/independent-parts, `design.md#file-changes` contracts and `specs/*/spec.md` labels/scenarios. Rollback: disable affected entrypoints/writes before compatible-reader reversion; retain data/audits/attendance/allocations/PDFs; never flatten/recolor/regenerate history. Lint/build ≠ behavioral proof.

## Phase 1: Prerequisites
- [ ] 1.1 Record affected R01–R12 approvals from [complete gates](exploration.md#twelve-request-traceability) in proposed `decisions.md`; reconcile touched historical/allocation-estimate drift and normal/manual aggregation before reuse, without automatic changes.
- [ ] 1.2 Audit `scripts/verify*` compatibility; arrange authorized nonproduction role/device/DB fixtures; read `node_modules/next/dist/docs/` before code.
- [ ] 1.3 Record R07 same-document/version URL/screenshots/device/browser/build reproduction in proposed `r07-evidence.md`; select fix/files afterward; re-estimate.

## Phase 2: Queue
- [x] 2.1 R01 `src/components/jobs/job-list.tsx`: one-interaction filters; T2.1; touch/keyboard/search/URL/back; revert filters; 120–240.
- [x] 2.2 R02 `src/components/technician/job-header.tsx`: audited assignment; T2.2; reassignment/missing/timezone; revert date; 180–320.
- [x] 2.3 R03/R04/R06 `src/lib/jobs/queries.ts` (`listTechnicianQueueJobs`): separate queue/tabs/priority (“Asignado / En revisión / Aprobado”); keep `listTechnicianJobs` routing unchanged; T2.3; mixed/filtered/financial-only families; revert queue; 280–400.

## Phase 3: Types
- [x] 3.1 R08 `src/lib/jobs/work-types.ts`, M(3.1): compatible representation; T3.1; scalar/unknown/old-client; disable type-writes; 250–400.
- [ ] 3.2 R08 `src/components/jobs/{job-form,office-job-actions}.tsx`: create/edit/assign in “Asignación y estado”; T3.2; concurrent/failed atomicity; disable controls; 250–400.
- [ ] 3.3 R08 `src/lib/storage/bulk-import-core.ts`: multi-type import; T3.3; round-trip; disable import; 200–350.
- [x] 3.4 R08 M(3.4): part-copy; T3.4; shared-fields/independent-finances; disable copy-writes; 150–300.
- [x] 3.5 R05 `src/components/jobs/job-list.tsx`: show types; T3.5; empty/legacy/detail; revert metadata; 100–200.

## Phase 4: Documents
- [ ] 4.1 R11 `src/components/jobs/job-documents.tsx`: qualified submission; T4.1; redelivery/regeneration/missing-version; revert date, preserve `current_delivery_id`; 250–400.
- [x] 4.2 R12 `src/lib/jobs/pdf-code-editor-core.ts`: new “azul rey”; T4.2; preview/final/missing-black/explicit-colors; revert defaults; 250–400.
- [ ] 4.3 R07 fix evidence-selected `r07-evidence.md` path; T4.3; same-document real-device parity; revert isolated fix; TBD.

## Phase 5: Attendance
- [ ] 5.1 R09 `src/lib/work-shifts/actions.ts`, M(5.1): authorized companions; T5.1; denial/concurrency/fuel-once; disable companion-writes; 300–400.
- [ ] 5.2 R09 `src/components/work-shifts/start-shift-form.tsx`: active presence; T5.2; solo/helpers/expiry/correction; revert presence; 200–350.

## Phase 6: Export
- [ ] 6.1 RED author T6.2/T6.4 route/RPC cases below before export production; co-deliver tests with behavior.

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| HTTP export | Forged viewer/week, inactive session, shared cache | Applicable | Derive viewer; validate period; deny invalid/unauthorized without data; private/no-store | Route/RPC RED: each case, cross-user body/cache leakage |

- [ ] 6.2 R10 `src/lib/jobs/weekly-export.ts`, M(6.2): personal snapshot; reject partial/inconsistent snapshots; T6.2; normal/manual/participant/dedup; disable RPC; 300–400.
- [ ] 6.3 R10 `src/lib/jobs/weekly-export.ts`: serialize PRISM/amount/coworkers/percentage; T6.3; cents/basis-points/Friday–Thursday/New_York/DST/empty; disable serializer; 200–350.
- [ ] 6.4 R10 `app/api/produccion/semanal/exportar/route.ts`: wire dashboard download; T6.4; cross-user denial/cache; disable download; 200–350.
