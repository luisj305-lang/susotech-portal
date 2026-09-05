# Tasks: Administrator Dashboard Visual Refresh

## Review Workload Forecast

Estimated changed lines: 1,720–2,760 authored additions+deletions, including tests/docs.
Delivery strategy: auto-chain
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
Implementation authorization: pending final user confirmation in chat

#436 resolves delivery only. Target≤400/child; 800 ceiling requires reforecast/authorization. No size:exception or execution/commit/push/deploy approval.

`tracker←PR1←PR2←PR3←PR4←PR5←PR6←PR7←PR8` (arrows: child→base/dependency); only tracker ultimately merges main. Future boundaries only.

Scope: administrator `/dashboard`; repository edits only; Desktop references read-only/private. Preserve [proposal](proposal.md), [invariants](exploration.md), [design](design.md); no backend/math/week/global/default-route changes.

## Work Units

NEW scripts/flags: `C(x)=node scripts/verify-admin-dashboard-contracts.mjs --case x`; `B(x)=node scripts/verify-admin-dashboard.mjs --case x`.
Each starts after its predecessor; finishes its checklist plus tests/docs. Rollback removes referenced task's scoped hunks/files; unwind descendants first.

|PR/unit|Lines|Task/rollback|Focused|Runtime|
|---|---|---|---|---|
|1 Offline|220–340|1.1|C(offline)|Fake-client modules|
|2 Sandbox|240–380|1.2–1.4|C(security)|Hostile-path/failure injections|
|3 Browser|260–400|1.5|C(isolation)|B(isolation)|
|4 Shell/dialog|260–400|2.1|C(scope)|B(scope)|
|5 Heading/KPIs/pending|200–340|2.2|C(preview)|B(preview)|
|6 Activity|260–400|2.3|C(activity)|B(activity)|
|7 Actions/accessibility|120–220|2.4|C(actions)|B(actions)|
|8 Acceptance|160–280|3.1|C(all)|B(all)|

`D=src/components/dashboard`. S1–S10 follow [spec](specs/admin-dashboard-presentation/spec.md) scenario order. UI styles accompany their unit. Otherwise `strict_tdd:false`.

## Phase 1: Verification Foundation

- [x] 1.1 Create `scripts/fixtures/admin-dashboard.ts` and C: allowlisted TypeScript loader executes real query/format modules against fake clients; cover S4–8.
- [ ] 1.2 RED C(security): spaced/metacharacter paths remain literal/no-shell; reject output escapes/missing executables; enforce executable/environment/temp/profile/loopback allowlists.
- [ ] 1.3 RED C(security): reject unexpected server/browser traffic; bound startup/child failure/timeouts; finally clean only owned processes/temp.

| Boundary | Applicability/reason | Safe/failure behavior; RED tests |
|---|---|---|
| Harness subprocess/network | Applicable | Trusted executables, argv/no shell, loopback, isolated temp/profile, allowlisted environment; reject escaped paths/unexpected server/browser traffic; timeouts/finally clean only owned processes/temp. RED: spaced/metacharacter paths, output escape, missing executable, unexpected traffic, startup/child failure. |

- [ ] 1.4 GREEN create `scripts/lib/dashboard-harness.mjs`: enforce threat-row contract; missing tooling fails explicitly, never installs.
- [ ] 1.5 Create B and `scripts/fixtures/dashboard-boundaries.ts`: no-env/credentials server auth/query/shift/fleet and browser Supabase fakes; deny SDK/external traffic; allowlisted actual-source temporary fixture, installed Next CLI `--webpack`, Chromium/CDP, approved temporary parent/profile/environment, local fonts, unchanged source hashes. Read-only `app/dashboard/{page,loading,error}.tsx`, `app/trabajos/importar/page.tsx`; no DB-fixture reuse.

## Phase 2: Scoped Presentation

- [x] 2.1 Modify `D/{admin-dashboard,app-shell,sidebar,topbar}.tsx`; create `D/admin-dashboard-{presentation.ts,dialog.tsx}` and `D/admin-dashboard.module.css`: admin opt-in/default-safe navy-navigation/light-header shell; native-dialog initial-focus/containment/inertness/Escape/trigger-restore, S1/10.
- [x] 2.2 Modify `D/{admin-dashboard,stat-cards,pending-review}.tsx`: four KPIs/weekheading; unchanged cents/units/serverflags/NYweeklinks; first-eight grid above full-width table; metadata/PDF states, 0/1/3/8/9, no mockcaps/backlogclaims; S3–5.
- [x] 2.3 Modify `D/worker-activity-table.tsx`: ten columns/allworkers/every-mobile-field; nine→two→none all-loaded TOTAL/mobileTOTAL; Spanish search/status/reset/sorting; name-modal versus Detalles-breakdowns/feedback; S6–8.
- [x] 2.4 Modify `D/{quick-actions,notifications-bell}.tsx`: bottom five-action bar; preserve destinations/handlers. Scope 44px targets, 14px text/16px inputs, AA/focus/Spanish. Conditional `src/components/ui/{page-header,stat-card,filter-toggle-chip}.tsx` hooks only if existing props/wrappers insufficient.

## Phase 3: Acceptance

- [ ] 3.1 Extend C/B/fixtures/CSS: all eight requirements/ten scenarios; 320/390/tablet/1600×1100/wider/200%, long values, supervisor/technician/other-admin defaults, errors/retry. After confirmation: `npm run lint`, guarded `npm run build`, `git diff --check`, isolated C/B; document fidelity and rollback (remove opt-in/restore legacy; no data repair).
