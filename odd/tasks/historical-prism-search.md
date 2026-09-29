# Historical PRISM Search

## Objective

Enable office dashboard users to look up every matching regular job by PRISM number, including historical invoiced, paid, archived, and old records.

## Problem / Why

The current office job list applies active, invoiced, or archived status buckets before its generic search. A PRISM lookup therefore misses valid historical regular-job records, preventing office staff from finding the complete job history for a PRISM number.

## Authorized Scope

- Add a dedicated PRISM lookup control to every office `AdminDashboard` rendering path. The form submits `GET /trabajos?prism=...`.
- Parse `prism` in the office `/trabajos` route, require office-viewer authorization there, and pass it to the regular-job query.
- Add a case-insensitive literal PRISM lookup option to `listOfficeJobs` that bypasses status/archive buckets only when supplied and returns every matching regular job.
- Extend the existing offline admin-dashboard fixture and contract verifier for the form, route, query, authorization, and historical-result contract.

## Constraints

- Technicians must not receive the historical lookup.
- Do not change generic `q` title/address/location behavior or normal status buckets.
- Do not include manual jobs or change manual-job history semantics.
- Preserve existing authorization and RLS boundaries; admin, supervisor, and auditor retain read access.
- No migrations, remote services, deployment, push, or pull request.
- Preserve pre-existing work, including the untracked `prueba/` directory.

## Delivery

- Chosen route: `delegated`.
- Trigger evidence: implementation spans the dashboard UI, office route, regular-job query, and offline fixture/verifier; preparation requires repository configuration and framework documentation review.
- Delivery strategy: `ask-on-risk`.

## TDD Plan

- Mode: contract-first offline TDD.
- Source: `scripts/fixtures/admin-dashboard.ts` and `scripts/verify-admin-dashboard-contracts.mjs`.
- Runner: `node scripts/verify-admin-dashboard-contracts.mjs --case offline`; `package.json` has no test script, so the existing offline contract runner is the project-specific test boundary.

## Task

- [ ] `ODD-HISTORICAL-PRISM-SEARCH-01` — Add office-only historical regular-job PRISM lookup and its offline contract coverage.

## Acceptance Criteria

- Both office `AdminDashboard` presentations render an explicit PRISM form that submits `GET` to `/trabajos` with the dedicated `prism` parameter.
- `/trabajos?prism=...` reads the first supplied value, requires office-viewer access, and invokes the regular-job lookup without assignment-week filtering.
- A non-empty `prism` lookup is literal and case-insensitive, returns all matching regular jobs, and includes archived, invoiced, paid, and old records.
- Existing `q` behavior and all normal active/invoiced/archived status buckets remain unchanged.
- Technicians cannot access the historical office lookup, and manual-job history remains excluded.
- The offline verifier proves the UI, route, query, authorization, and historical-result contract.

## Planned Checks

- `node scripts/verify-admin-dashboard-contracts.mjs --case offline`
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- `node node_modules/eslint/bin/eslint.js "src/components/dashboard/admin-dashboard.tsx" "app/trabajos/page.tsx" "src/lib/jobs/queries.ts" "scripts/fixtures/admin-dashboard.ts" "scripts/verify-admin-dashboard-contracts.mjs"`
- `git diff --check`
- `npm run build`

## Initial Progress

Baseline recorded on `main`: untracked `prueba/`; no tracked changes. Created feature branch `feat/historical-prism-search`. The initial task document was mirrored to Engram observation `#1494` and read back before source edits.

## Completion Progress

- [x] `ODD-HISTORICAL-PRISM-SEARCH-01` — Add office-only historical regular-job PRISM lookup and its offline contract coverage.

## Changed Files

- `src/components/dashboard/admin-dashboard.tsx` — Added one explicit GET PRISM lookup form and rendered it in both office dashboard presentations.
- `app/trabajos/page.tsx` — Parsed `prism`, enforced office-viewer access in the office branch, bypassed week filtering only for a non-empty PRISM lookup, and excluded manual jobs from that lookup.
- `src/lib/jobs/queries.ts` — Added literal, case-insensitive `prism` lookup behavior that bypasses normal regular-job status/archive/category buckets only when present.
- `scripts/fixtures/admin-dashboard.ts` — Added deterministic active, archived, invoiced, paid, old, and title-only PRISM fixture records.
- `scripts/verify-admin-dashboard-contracts.mjs` — Added offline query/UI/route contract assertions and an explicit auth-session stub required by the existing regular-job query module.
- `odd/tasks/historical-prism-search.md` — Recorded the ODD plan, scope, evidence, and receipt.

## Acceptance Evidence

- Both `AdminDashboard` presentation paths reuse the explicit `/trabajos` GET form with `name="prism"`.
- The office route reads the first `prism` value, calls `requireOfficeViewer()`, forwards `prism` to `listOfficeJobs`, skips assignment-week filtering only for that explicit lookup, and returns no manual-job entries for it.
- The query compares normalized PRISM values with exact equality after bypassing normal status/archive/category buckets only for a non-empty lookup.
- The offline fixture returns four matching regular records with the same PRISM across active, archived, invoiced, and paid/old states; it also proves wildcard characters are literal and generic title/PRISM search retains normal active buckets.

## Verification Results

- Source-mutating normalization: not required. `package.json` defines `dev`, `build`, `start`, and `lint` only; no normalization script is configured.
- `node scripts/verify-admin-dashboard-contracts.mjs --case offline` — passed: `PASS admin-dashboard offline contracts: 6 scenarios, 106 assertions`.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false` — passed with no output (exit code 0).
- `node node_modules/eslint/bin/eslint.js "src/components/dashboard/admin-dashboard.tsx" "app/trabajos/page.tsx" "src/lib/jobs/queries.ts" "scripts/fixtures/admin-dashboard.ts" "scripts/verify-admin-dashboard-contracts.mjs"` — passed with no output (exit code 0).
- `git diff --check` — passed (exit code 0). Git printed only existing CRLF conversion warnings for modified tracked files.
- `npm run build` — passed: Next.js 16.3.0 compiled, type-checked, collected page data, and generated all 36 static pages.

## Work-Unit Receipt

- Authored-line estimate: approximately 350 additions and deletions, including the ODD record and offline coverage; the pre-existing untracked `prueba/` directory is excluded.
- Rationale: exact in-memory comparison keeps PRISM lookup literal, avoids PostgREST wildcard semantics, and changes no generic search behavior. A PRISM lookup is regular-job-only and explicitly suppresses the manual-work collection.
- Rollback boundary: remove the six files listed in **Changed Files** from this work unit; no migration, remote state, or unrelated working-tree content is involved.
- Commit identity: pending the required work-unit commit. The final receipt will record it in this document and its Engram mirror.

## Next Step

Create the scoped Conventional Commit, record its identity in both mirrors, then run `gentle-ai review mode status` without starting a review.
