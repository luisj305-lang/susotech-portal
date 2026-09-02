# Tasks: Portal-wide Compact Responsive Redesign

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,200 |
| Selected review budget | 800 changed lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Three autonomous stacked-to-main PR slices |
| Execution mode | auto |
| Artifact store | both |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |
| Maintainer approval | `auto-chain` with `stacked-to-main` |
| Chained or stacked delivery | Enabled |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Apply gate:** Proceed only through autonomous `stacked-to-main` slices. Each future PR targets the preceding slice branch, or `main` after that slice merges. No `size:exception` is active. Generation 11 is the authorized `current-candidate-production-readiness` slice; generation 10 task 3.3 evidence is settled and may be accepted only because its source identity matches the generation 11 starting tree exactly.

**Cumulative status:** 12/17 tasks complete. Task 3.3 and task 4.1 are complete; tasks 4.2–4.6 remain pending because authenticated visual and protected-behavior evidence is unavailable without a non-production role fixture.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Foundations and office/admin | Stacked PR 1 | `npm run lint` | Admin cells at both viewports | Only files in 1.1–2.4 |
| 2 | Technician and fleet surfaces, including 3.1–3.3 | Stacked PR 2 | Focused lint for technician and fleet paths | Field, Fleet, and technician navigation at both viewports | Only files in 3.1–3.3 |
| 3 | Full evidence and release gate | Stacked PR 3 | `npm run build` | All 12 cells and behavior smokes | Verification evidence only; preserve work units 1 and 2 |

## Phase 1: Presentation Foundations

Threat Matrix: all rows are N/A, so no RED security-boundary tests apply.

### Pre-redesign behavior baseline

- Office navigation keeps its local Dashboard, Jobs, Fleet, Import, Review, and Manual Jobs destinations, adds catalog/users/history only for admins, derives active presentation from the existing pathname helper, and clears technician-shift prompt storage before Supabase sign-out, login replacement, and router refresh.
- Server access remains authoritative: `requireProfile` redirects unauthenticated users to `/login`, inactive or missing profiles to `/acceso-denegado`, and role-specific pages retain their existing guards; technician jobs continue to call `requireActiveShiftPage` before loading jobs.
- PDF delivery remains field-worker-only, requires an active shift, accepts only assigned or in-review non-archived jobs with an original PDF, verifies the source-document manifest, and treats any failed prerequisite or initialization as not found.

- [x] 1.1 Modify `app/globals.css` with compact density, spacing, radius, shadow, control, focus, and safe-area tokens; retain semantic color meanings.
- [x] 1.2 Modify `src/components/ui/button.tsx`, `src/components/ui/card.tsx`, and `src/components/ui/page-header.tsx` presentation only; retain props, labels, semantics, and interactions.
- [x] 1.3 Modify `src/components/ui/empty-state.tsx` and `src/components/ui/status-badge.tsx`; retain recovery messages, status mapping, labels, and semantics.
- [x] 1.4 In `openspec/changes/portal-redesign/tasks.md`, record baseline outcomes for current navigation, guards, shifts, and PDF delivery before visual edits.

## Phase 2: Office and Administration

- [x] 2.1 Modify `src/components/dashboard/app-shell.tsx`, `src/components/dashboard/sidebar.tsx`, and `src/components/dashboard/topbar.tsx` presentation only; retain role filtering, hrefs, matching, drawer, and logout.
- [x] 2.2 Modify `src/components/dashboard/admin-dashboard.tsx`, `src/components/dashboard/stat-cards.tsx`, and `src/components/dashboard-client.tsx`; retain queries and role-derived actions.
- [x] 2.3 Modify `src/components/dashboard/worker-activity-table.tsx` and `src/components/dashboard/pending-review.tsx`; retain filters, dialogs, links, status, empty states, and responsive representations.
- [x] 2.4 Modify `app/trabajos/page.tsx` composition only for Office Jobs and Review; retain server data, actions, URL destinations, and outcomes.

## Phase 3: Technician and Fleet

- [x] 3.1 Modify `src/components/dashboard/field-shell.tsx` presentation only; retain existing destinations and field workflow behavior.
- [x] 3.2 Modify `src/components/fleet/technician-fleet-workspace.tsx` and `app/camiones/mi-camion/page.tsx`; retain fleet actions, forms, validation, and data flow.
- [x] 3.3 After dirty `technician-route` work is integrated cleanly, separately modify `src/components/dashboard/technician-app-shell.tsx` and `src/components/dashboard/mobile-bottom-nav.tsx`; retain local items, `#evidencias`, active matching, safe logout cleanup, and safe-area navigation.

Task 3.3 implementation, focused checks, and runtime navigation passed under evidence revision `sha256:50dd3c2ef9d89fbe1584ddfd7344cd1f01e3baf917a8f2b2c9345d66c9e2feab`. Identity is established: generation 10 finished at candidate tree `bf17cc450c15d0762bebc986b00a5abecc6e79d5`, generation 11 began at the same tree, `HEAD` is authorized base `8292660b75f2a1cd29a6ad238bcca650f83b4e39`, and the two task files still total 48 changed lines (25 additions, 23 deletions). The current blobs are `150b459a2550f59f75e4e74bfada87055a449adf` and `79887cd52cd9ef37fb99c52e9ddabf6e0fd1612f`; the scoped patch digest is `sha256:bc8330ef4e19d280995ae042945483b8f9471d60118ff144c0b0112938e34d87`.

## Phase 4: Verification and Release Evidence

- [x] 4.1 In `openspec/changes/portal-redesign/tasks.md`, record passing `npm run lint` and `npm run build`; no unit, E2E, or visual test suite exists.
- [ ] 4.2 Record 1440x900 and 390x844 evidence in `openspec/changes/portal-redesign/tasks.md` for Admin Dashboard and Administration (four cells): hierarchy, no clipping/image-only controls, focus, touch/safe area, retained states, navigation, and allowed action.
- [ ] 4.3 Record the same evidence for Supervisor Office Jobs and Review (four cells) in `openspec/changes/portal-redesign/tasks.md`, including active-route and logout behavior.
- [ ] 4.4 Record the same evidence for Technician Field and Fleet (four cells) in `openspec/changes/portal-redesign/tasks.md`, including active-shift reachability.
- [ ] 4.5 Leave `src/lib/auth/session.ts`, `src/lib/work-shifts/access.ts`, `src/components/jobs/pdf-code-editor.tsx`, and `app/trabajos/[id]/entregar/page.tsx` unchanged; smoke allowed/denied URLs, shift access, and valid/invalid PDF delivery against baseline.
- [ ] 4.6 Update `openspec/changes/portal-redesign/tasks.md` with all 12 PASS cells before one bundled release; otherwise revert the visual bundle without touching `technician-route` work.

## Final Production-readiness Apply Evidence (Generation 11)

### Delivery Metadata Reconciliation

- execution_mode: `auto`.
- artifact_store: `both`.
- review_budget_lines: `800`.
- delivery_strategy: `auto-chain`.
- chain_strategy: `stacked-to-main`.
- Current work unit: Stacked PR 3, `current-candidate-production-readiness`.
- Historical `exception-ok` / `size-exception` fields remain historical evidence only; they do not describe current delivery authority.

### Automated Quality Evidence

| Command | Exact result |
|---|---|
| `npm run lint` | Exit `0`; `0 errors`, `1 warning`. The warning is the unchanged pre-existing `currentUserId` unused-variable warning at `src/components/manual-jobs/manual-jobs-manager.tsx:65:3`. |
| `npm run build` | Exit `0`; Next.js `16.3.0`; compiled successfully in `8.4s`; TypeScript finished in `12.2s`; static generation completed `28/28`; all listed routes built. |
| `git diff --check` | Exit `0`; `0` whitespace errors. Git emitted only LF-to-CRLF working-copy notices; no file was normalized. |

### Required 12-cell Visual Matrix

Chrome headless itself passed isolated capability probes at exactly `1440x900` and `390x844` (exit `0` at both sizes), but no authenticated visual verifier is available. The repository has no Playwright/Cypress dependency or configuration, no browser MCP/CDP-authenticated session, no test-role credentials, and no local Supabase runtime. `.env.local` points to a remote Supabase project, so creating role fixtures would mutate remote data and is prohibited. Static source inspection is not accepted as visual proof.

| Role | Board / route | Viewport | Result | Exact blocker |
|---|---|---:|---|---|
| Admin | Dashboard (`/dashboard`) | 1440x900 | BLOCKED | No authenticated non-production Admin session; the runtime reaches `/login`, so hierarchy, clipping, focus, retained states, navigation, and allowed actions cannot be observed truthfully. |
| Admin | Dashboard (`/dashboard`) | 390x844 | BLOCKED | No authenticated non-production Admin session; touch and safe-area behavior cannot be observed truthfully. |
| Admin | Administration (`/usuarios`) | 1440x900 | BLOCKED | No authenticated non-production Admin session; Administration content and allowed actions cannot be observed truthfully. |
| Admin | Administration (`/usuarios`) | 390x844 | BLOCKED | No authenticated non-production Admin session; touch, clipping, and retained states cannot be observed truthfully. |
| Supervisor | Office Jobs (`/trabajos`) | 1440x900 | BLOCKED | No authenticated non-production Supervisor session; role navigation, active route, logout, and allowed actions cannot be observed truthfully. |
| Supervisor | Office Jobs (`/trabajos`) | 390x844 | BLOCKED | No authenticated non-production Supervisor session; touch, clipping, and retained states cannot be observed truthfully. |
| Supervisor | Review (`/trabajos?status=en_revision`) | 1440x900 | BLOCKED | No authenticated non-production Supervisor session; review state and allowed actions cannot be observed truthfully. |
| Supervisor | Review (`/trabajos?status=en_revision`) | 390x844 | BLOCKED | No authenticated non-production Supervisor session; mobile review, focus, touch, and logout cannot be observed truthfully. |
| Technician | Field (`/trabajos`) | 1440x900 | BLOCKED | No authenticated non-production Technician session with controlled shift state; field hierarchy and active-shift reachability cannot be observed truthfully. |
| Technician | Field (`/trabajos`) | 390x844 | BLOCKED | No authenticated non-production Technician session with controlled shift state; bottom navigation and safe area cannot be observed truthfully. |
| Technician | Fleet (`/camiones/mi-camion`) | 1440x900 | BLOCKED | No authenticated non-production Technician session with an assigned vehicle; fleet state and actions cannot be observed truthfully. |
| Technician | Fleet (`/camiones/mi-camion`) | 390x844 | BLOCKED | No authenticated non-production Technician session with an assigned vehicle; touch, safe area, and retained fleet states cannot be observed truthfully. |

Passed visual cells: `0/12`. Task 4.6 remains open, and no production-readiness claim is made.

### Protected Behavior Smoke Evidence

The protected files remain byte-identical to `HEAD`:

| Protected path | Git blob |
|---|---|
| `src/lib/auth/session.ts` | `653282661f6808fa7e260aa58ef556c844414071` |
| `src/lib/work-shifts/access.ts` | `6b69675ec94c0c50098a3270658574c730f3754c` |
| `src/components/jobs/pdf-code-editor.tsx` | `7379b62eaebfae4f4ec686d2df0e12c513c5b4d1` |
| `app/trabajos/[id]/entregar/page.tsx` | `36a52e184263f4d3b52c20d976cb92a269a42566` |

An owned production Next runtime on port `65414` passed eight unauthenticated boundaries:

| URL | Exact result |
|---|---|
| `/login` | HTTP `200`, `11,767` bytes. |
| `/dashboard` | HTTP `307`, `Location: /login`. |
| `/usuarios` | HTTP `307`, `Location: /login`. |
| `/trabajos?status=en_revision` | HTTP `200`, `9,262` bytes, streamed `/login` marker present. |
| `/camiones/mi-camion` | HTTP `307`, `Location: /login`. |
| `/jornada/iniciar` | HTTP `307`, `Location: /login`. |
| `/catalogo` | HTTP `307`, `Location: /login`. |
| `/trabajos/00000000-0000-4000-8000-000000000000/entregar` | HTTP `200`, `10,201` bytes, streamed `/login` marker present. |

Allowed role URLs, role denial, controlled active/inactive shift cases, and full valid/invalid server PDF delivery remain BLOCKED by the same missing authenticated non-production fixture. The current pure placement validator did pass at runtime: one valid placement returned `null`, quantity `0` returned `Hay un código con cantidad inválida.`, and overlap returned `Hay códigos superpuestos.`. The repository's broader `scripts/verify-pdf-code-editor-runtime.mjs` exits `1` before assertions because it imports removed `codeColor` and uses the obsolete placement schema; no PASS is claimed from it.

### Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `npm run lint` exit `0` (`0` errors, `1` unchanged warning); `npm run build` exit `0` (`28/28` static pages); `git diff --check` exit `0`. |
| Runtime harness command/scenario and exact result | `next start --hostname 127.0.0.1 --port 65414`; eight unauthenticated requests passed. Root/listener PID `23324`, captured PIDs `20748, 23324`; cleanup left listener count `0` and captured owned-process count `0`. Authenticated scenarios are explicitly BLOCKED, so tasks 4.2–4.6 are not complete. |
| Rollback boundary | Revert only this generation's bookkeeping in `openspec/changes/portal-redesign/tasks.md`, `openspec/changes/portal-redesign/apply-progress.md`, and Engram topics `sdd/portal-redesign/tasks` / `sdd/portal-redesign/apply-progress`; no application source was edited by this batch. |

Evidence payload revision: `sha256:f463a0ff961c5cb9fb2ec6b6136716362f26ca4746b7768ac98062d15137e7de`.

### Native Attempt Settlement

- Token `sha256:582bdad2188e7604c65dc3dd336a21b6844718b9832ba700b2014f0cdc8c17ae` was settled exactly once with request id `portal-redesign-production-readiness-settle-20260901-001` and outcome `failed`.
- Result: `state: blocked`, `reason: maintainer_decision`; generation `11` recorded outcome `failed`, changed lines `0`, evidence revision `sha256:f463a0ff961c5cb9fb2ec6b6136716362f26ca4746b7768ac98062d15137e7de`, and finish tree `bf17cc450c15d0762bebc986b00a5abecc6e79d5`.
- Ledger revision: `sha256:722eaee67be95d9b0ddbe8b2d06c9860a73321cc10deb51d3230cfe4dc43b1cd`; `complete: false`, `decision_required: true`, `next_action: reset`.
- No retry or reset was performed. `next_recommended: none` while the authenticated non-production evidence capability is absent.
