# Hourly payroll week navigation (office side)

## Objective

Let admin, supervisor, and auditor browse previous Friday–Thursday hourly-payroll
periods on `/nomina`. Today the page is hard-wired to the current period via
`currentNewYorkPayrollPeriod()`, so "last week" cannot be viewed. Add week
navigation (previous / current / next) mirroring the dashboard, and render past
periods read-only (hours and amounts visible, no approval or correction). The
current period keeps its existing approve/correct actions.

## Authorized scope and constraints

- Local implementation and offline verification only. No production access,
  migration execution, deployment, push, or PR creation.
- User confirmed: "tal cual lo que dices, nada más" — exactly the week-navigation
  plan, read-only past periods, current period unchanged. Do not broaden scope.
- This is a query-layer and UI change only. No new migration and no SQL change:
  `technician_shifts` and `technician_pay_period_records` are already queryable
  for any period via the existing `periodStart`/`work_date` filters.
- Read-only past periods are enforced at the UI layer (hide approve/correct),
  matching the agreed scope. The server RPCs (`approve_hourly_pay_period_record`,
  `correct_hourly_shift`) already refuse already-approved periods; do not add new
  server guards beyond scope.
- Code, technical docs, test descriptions, and commit messages are English;
  the Spanish UI text is extended professionally.
- The working tree contains extensive pre-existing dirty/untracked work (the
  whole hourly-payroll feature is untracked). Never `git add` blindly, never
  revert or touch unrelated files, and do not commit anything.
- Next.js 16.3.0. Follow the existing App Router search-param pattern already
  used by `app/dashboard/page.tsx`; do not invent a new convention.

## Execution and delivery

- Route: delegated direct, not SDD. One writer owns all implementation.
- Branch: `feat/manual-office-week-cutoff` (do not switch branches).
- Starting HEAD / first review boundary:
  `a043b69a9c12fd22c25478bcb8813cfc6aa9b315`.
- TDD: OFF (`openspec/config.yaml` `rules.apply.tdd: false`,
  `strict_tdd: false`). No `npm test`. Use ordinary behavioral verification.
- RDD: ON, effective source `global`, read on 2026-09-25. Parent owns consent and
  native lifecycle; the writer does not start reviews or toggle RDD.
- No commit, push, or PR authorized for this change. Work-unit commit is held
  pending a parent decision on the dirty-tree commit boundary.

## Tasks and acceptance

- [ ] **T1 — Add weekly navigation and read-only past periods to `/nomina`.**
  Route: delegated; trigger: multiple non-trivial files (query, type, page,
  table) plus a new static verification script.
  Changes:
  1. `src/lib/payroll/types.ts` — add `isCurrentPeriod: boolean` to
     `OfficeHourlyPayroll`.
  2. `src/lib/payroll/queries.ts` — change `getOfficeHourlyPayroll()` to
     `getOfficeHourlyPayroll(weekOffset = 0)`. Import `referenceAtForNewYorkWeek`
     and compute
     `const referenceAt = new Date(referenceAtForNewYorkWeek(weekOffset))` then
     `currentNewYorkPayrollPeriod(referenceAt)`. Return
     `isCurrentPeriod: weekOffset === 0`. Keep the existing directory/settings/
     periods/shifts queries unchanged.
  3. `app/nomina/page.tsx` — read `searchParams` (type
     `Promise<Record<string, string | string[] | undefined>>`, awaiting it, same
     as the dashboard), parse `week` to an integer (default 0), pass it to
     `getOfficeHourlyPayroll(weekOffset)` and to `OfficePayrollTable`.
  4. `src/components/payroll/office-payroll-table.tsx` — accept `weekOffset`,
     render week navigation links (`/nomina?week=${weekOffset - 1}`,
     `/nomina?week=${weekOffset + 1}`, and a "Semana actual" link when
     `weekOffset !== 0`), and gate actions on `data.isCurrentPeriod`: no
     "Aprobar" button and no "Corregir" in the detail rows for past periods;
     "Ver detalle" remains available read-only. Adjust the header description
     for past periods so it does not say "Aprueba el pago…".
  5. `scripts/verify-nomina-week-navigation-static.mjs` (new) — static
     assertions that the query accepts a `weekOffset` and derives the period
     from `referenceAtForNewYorkWeek` + `currentNewYorkPayrollPeriod`, that the
     page reads `searchParams.week`, and that the table renders `?week=` links
     and gates approve/correct on `isCurrentPeriod`.
  Rollback: revert the four touched source files and delete the new script; no
  data is mutated.
  Implementation/verification: PASS. `verify-nomina-week-navigation-static.mjs`
  PASS (week-offset-query=isCurrentPeriod-flag=week-param=read-only-gating);
  `tsc --noEmit --incremental false` exited 0; ESLint on the five files exited 0;
  `git diff --check` clean. Parent spot-check re-ran the static script and tsc
  (both clean). No production code beyond the five files touched.
  Commit: held. RDD tier/outcome: parent-owned, pending. Not closed.

## Verification commands

Run from the repository root, offline.

- `node scripts/verify-nomina-week-navigation-static.mjs`
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- `node node_modules/eslint/bin/eslint.js "app/nomina/page.tsx" "src/lib/payroll/queries.ts" "src/lib/payroll/types.ts" "src/components/payroll/office-payroll-table.tsx" "scripts/verify-nomina-week-navigation-static.mjs"` (check only)
- `git diff --check -- "app/nomina/page.tsx" "src/lib/payroll/queries.ts" "src/lib/payroll/types.ts" "src/components/payroll/office-payroll-table.tsx" "scripts/verify-nomina-week-navigation-static.mjs"`

No network build, credential access, production query, or browser pass implied.

## Progress and next step

- Read-only exploration complete. Gap confirmed: `getOfficeHourlyPayroll` and
  `/nomina` are fixed to the current Friday–Thursday period; no week offset or
  navigation exists. The dashboard's `app/dashboard/page.tsx` search-param and
  `admin-dashboard.tsx` `weekControls` patterns are the in-repo reference.
- Time arithmetic already supported by `src/lib/time/new-york-week.ts`
  (`referenceAtForNewYorkWeek` + `currentNewYorkPayrollPeriod`), so no new
  time helper or migration is required.
- T1 complete: one writer implemented the query offset, `isCurrentPeriod` flag,
  page `searchParams.week` parsing, week-navigation controls, and read-only
  gating for past periods, plus the new static verifier. All four verification
  commands passed and the parent re-ran the static script + tsc cleanly.
- Commit/review/delivery remain parent-owned. The whole hourly-payroll feature
  (including these five files) is untracked in the dirty tree, so a clean
  feature-only commit needs a parent decision. The hourly-payroll migrations are
  still NOT APPLIED remotely, so the feature is not live until that is
  authorized and deployed separately.
