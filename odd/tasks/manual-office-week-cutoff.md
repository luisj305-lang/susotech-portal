# Manual office jobs and prospective weekly attribution

## Objective

Let administrators and supervisors create manual jobs with a description, work
date, and selected financial week, and correct newly created jobs after approval.
Work submitted on Thursday and approved on Saturday must remain attributable to
the submission period. Preserve all pre-existing jobs and financial history.

## Authorized scope and constraints

- Local implementation and offline verification only. No production access,
  migration execution against remote databases, deployment, push, or PR creation.
- The user explicitly instructed: "deja intacto lo anterior". No backfill,
  historical financial recalculation, or new editor for legacy manual records.
- Extend the existing Spanish UI professionally; code, technical documentation,
  test descriptions, and commit messages are English.
- Preserve technician creation and participant-scoped visibility. Auditors remain
  read-only. Office permissions must be enforced by the server and database.
- Preserve operational list weeks: assignment for regular jobs and registration
  for manual jobs. Financial attribution is a separate concern.
- Current regular financial SQL already uses the current delivery submission
  timestamp. Add proof before changing it; do not blindly rewrite existing data.
- New manual records need an explicit prospective marker/financial period;
  records predating this feature retain their current reviewed-at fallback.
- No modification of old migrations or unrelated finance, fleet, or payroll work.
- Existing extensive dirty/untracked work must not be reverted or included in
  feature commits accidentally. If a coherent commit cannot exclude it, record
  the blocker rather than commit another feature's changes.

## Execution and delivery

- Route: delegated direct, not SDD. One writer owns all implementation.
- Branch: `feat/manual-office-week-cutoff`.
- Starting HEAD / first review boundary:
  `a043b69a9c12fd22c25478bcb8813cfc6aa9b315`.
- TDD: OFF, explicitly configured by `openspec/config.yaml` (`rules.apply.tdd`
  and `strict_tdd`). Use ordinary behavioral verification; framework presence
  does not enable strict TDD.
- Test runner: standalone Node scripts and disposable local PGlite. There is no
  `npm test` script. Do not run credential-bearing runtime scripts or install tools.
- RDD: ON, effective source `global`, read on 2026-09-22. Parent owns consent
  and native lifecycle; writer does not start reviews or enable/disable RDD.
- Delivery strategy: `ask-on-risk`; chain strategy not selected. No PR authorized.
- Forecast: approximately 1,400–2,100 authored added/deleted lines, excluding
  pre-existing changes. This exceeds the delivery planning budget: resolve chain
  strategy before the next work-unit commit. About 400 lines per implementation
  task is advisory, never a reason to omit tests, compress code, or split behavior
  artificially.
- Work-unit commits: pending. Parent must inspect exact task deltas and preservation
  of prior dirty work before authorizing staging. Never use blanket staging.

## Tasks and acceptance

- [ ] **T1 — Prove existing submission-week and legacy behavior.**
  Route: delegated; trigger: SQL/report mapping and regression preparation span
  more than four files. Cover Thursday submission / Saturday approval, New York
  Friday boundaries, regeneration, and unchanged legacy manual attribution.
  Only change regular behavior if a scoped reproducible failure warrants it.
  Rollback: remove the feature regression and any isolated proven fix only.
  Implementation/verification: PASS (16 SQL behavioral checks plus baseline
  regeneration regression). No regular production behavior changed. The harness
  exercises report functions with persisted submission/approval timestamps;
  it does not simulate the storage-backed upload RPC or live browser flow.
  Commit: held. RDD tier/outcome: parent-owned, pending. Not closed.
- [ ] **T2 — Add prospective office manual creation and consistent reporting.**
  Route: delegated; trigger: multiple non-trivial UI/action/schema/report files.
  Add description, work date, selected Friday–Thursday financial week, and
  admin/supervisor creation. Keep new record financial week stable on approval;
  preserve legacy fallback. Cover authorized roles, denied roles, participants,
  dashboard/history/export agreement, and independent operational placement.
  Rollback: disable new creation entry points and keep additive data; do not
  remove recorded history or revert pre-existing file hunks.
  Implementation/verification: implemented; cutoff SQL PASS (49 checks), cutoff
  UI PASS (20 checks), existing manual-work-ui/mixed-work-lists PASS, TypeScript
  exited 0. The mixed-list test initially failed on the intentionally versioned
  RPC name; its two expected names were updated without changing its behavior
  assertions, then it passed. Final full sweep completed under T3 below;
  the separate office UI aggregate limitation remains explicit.
  Commit: held. RDD tier/outcome: parent-owned, pending. Not closed.
- [ ] **T3 — Safely edit new approved manual jobs.**
  Route: delegated; trigger: atomic database mutation, editor, audit, receipt,
  and concurrency tests require coordinated non-trivial changes.
  Restrict editing to office staff and feature-era records. Preserve approval
  timestamps; update header/worker changes atomically with concurrency protection
  and an audit trail. Prevent edits or week selection from changing historical
  cuts protected by the user's instruction. Keep generated receipt consistent
  or explicitly unavailable, never silently serve an obsolete PDF.
  Rollback: disable editor/update entry points; preserve audit/data. Financial
  reversals need explicit authorization, not an automatic rollback.
  Implementation/verification: implemented and offline-verified. Final cutoff SQL
  PASS 118 checks; cutoff UI PASS 69 checks. Approved identity preservation,
  stale-version rejection, late audit failure rollback and receipt invalidation
  passed. Sequential stale-writer behavior was verified; no live multi-connection
  concurrency or browser/storage integration pass is claimed.
  Commit: held. RDD tier/outcome: parent-owned, pending. Not closed.

## Verification commands

All commands run from the repository root, offline. Use the installed PGlite
module at `C:\Users\Bryan Jimenez\AppData\Local\Temp\opencode\pdf-removal-sql-tools\node_modules\@electric-sql\pglite\dist\index.js`.

- `node scripts/verify-manual-work-ui.mjs`
- `node scripts/verify-mixed-work-lists.mjs`
- `node scripts/verify-regeneration-preserves-allocation-static.mjs`
- `node scripts/verify-manual-work-participants-sql.mjs "C:\Users\Bryan Jimenez\AppData\Local\Temp\opencode\pdf-removal-sql-tools\node_modules\@electric-sql\pglite\dist\index.js"`
- `node scripts/verify-worker-assigned-week-sql.mjs "C:\Users\Bryan Jimenez\AppData\Local\Temp\opencode\pdf-removal-sql-tools\node_modules\@electric-sql\pglite\dist\index.js"`
- `node scripts/verify-manual-office-week-cutoff-sql.mjs "C:\Users\Bryan Jimenez\AppData\Local\Temp\opencode\pdf-removal-sql-tools\node_modules\@electric-sql\pglite\dist\index.js"`
- `node scripts/verify-manual-office-week-cutoff-ui.mjs`
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- `node node_modules/eslint/bin/eslint.js "app/manual/page.tsx" "app/api/produccion/semanal/exportar/route.ts" "src/components/manual-jobs/manual-jobs-manager.tsx" "src/components/dashboard-client.tsx" "src/lib/manual-jobs/actions.ts" "src/lib/manual-jobs/queries.ts" "src/lib/manual-jobs/types.ts" "src/lib/manual-jobs/pdf.ts" "scripts/verify-manual-office-week-cutoff-sql.mjs" "scripts/verify-manual-office-week-cutoff-ui.mjs" "scripts/verify-mixed-work-lists.mjs"` (check only).
- `git diff --check -- "app/manual/page.tsx" "app/api/produccion/semanal/exportar/route.ts" "src/components/manual-jobs/manual-jobs-manager.tsx" "src/components/dashboard-client.tsx" "src/lib/manual-jobs/actions.ts" "src/lib/manual-jobs/pdf.ts"`.

Normalize before final verification. No network build, credential access,
production queries, live migration application, or browser pass is implied.

## Progress and next step

- Read-only exploration complete; historical preservation decision confirmed.
- Writer loaded the injected work-unit-commits and cognitive-doc-design skills,
  root/docs instructions, project plan, and installed Next.js server/revalidation guides.
- Baseline: manual-work-ui, mixed-work-lists, regeneration-preserves-allocation-static
  all PASS; manual-work-participants-sql PASS (57 checks), worker-assigned-week-sql
  PASS (37 checks). All executed using the commands above, locally only.
- Pre-existing tracked deltas (added/deleted): weekly CSV 43/23, manual page 5/8,
  dashboard-client 43/5, manual manager 31/27. Manual queries/types, work-list,
  participant/auditor migrations and supporting tests are already untracked.
  A task-only commit cannot silently absorb those dependencies.
- T1 command: new cutoff SQL script above exited 0, PASS 16 behavioral checks.
  Thursday/Saturday attribution, legacy approval fallback and both DST boundaries
  passed against actual existing SQL report functions.
- T2: additive nullable metadata and a one-time server-owned activation boundary;
  versioned creation/list/earnings RPCs, legacy-compatible report replacements,
  role-gated form, financial-date labels and operational documentation implemented.
  No old migration or regular mutation code changed. Migration NOT APPLIED remotely.
- T2 commands: cutoff SQL PASS 49; cutoff UI PASS 20; manual-work-ui PASS;
  mixed-work-lists PASS after scoped RPC expectation update; tsc exited 0.
- T3: office-only editor and update RPC, row lock + optimistic revision, immutable
  before/after audit, preserved approval identity, revisioned initial PDF attachment
  and explicit unavailable receipt after edits implemented. Legacy edits rejected.
- The expanded UI harness first failed because pdf-lib rejects cross-realm Array
  values. Moving execution to same-realm compileFunction, with allowlisted imports,
  fixed the harness; actual local PDF composition then passed. No application
  workaround was added for that test-only failure.
- Final normalized-source sweep: cutoff SQL PASS 118; cutoff UI PASS 69;
  manual-work-ui PASS; mixed-work-lists PASS; regeneration static PASS;
  manual-work-participants-sql PASS 57; worker-assigned-week-sql PASS 37;
  TypeScript exit 0; explicit ESLint exit 0; explicit tracked diff check exit 0.
  Git only warned about its existing LF-to-CRLF checkout conversion.
- Known separate limitation empirically reproduced in cutoff UI test:
  `getWorkerOperationsDashboard` (`src/lib/jobs/queries.ts:203-210`) displays 12000
  for regular/manual rows of 10000 + 12000 rather than 22000. SQL report/technician
  export agreement passed; full office UI total agreement remains blocked by this
  pre-existing Map overwrite, intentionally not fixed.
- Feature-only estimate: approximately 1,400-1,500 authored added/deleted lines,
  including tests/docs/tracking. New migrations/tests initially counted 970 lines
  (292 + 137 + 298 + 243); exact git diff counts for shared dirty files are not
  task-only counts. No staging, commit, branch switch, PR, push or remote action.
- Commit dependency evidence: manager imports pre-existing untracked manual types;
  queries depend on pre-existing participant visibility and auditor SQL; tests use
  the pre-existing untracked work-list-test-harness. Existing CSV/dashboard hunks
  already supplied manual earnings, and were extended rather than overwritten.
  A coherent clean commit requires parent decisions on those prerequisite units.
- Both additive migrations remain NOT APPLIED remotely. No live browser, mobile,
  storage, production network build or production verification was performed.
- Next: parent resolves prerequisite preservation, chain strategy and commit/RDD
  lifecycle. Deployment/live checks require separate authorization. Product scope
  was not broadened; no paid ledger or regular resubmission policy was introduced.
- Final completion requires observed outcomes/checks; commit/review/delivery
  blockers remain explicit and must not be represented as approval.
