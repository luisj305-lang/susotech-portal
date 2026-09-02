# Tasks: Technician Route (GPS → pending jobs)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600–700 |
| Effective review budget | 800 (session override of 400 default) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |
| Chain strategy | pending |
| Suggested split | Single PR |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Foundation + core + UI + verification | PR 1 | `node scripts/verify-technician-route-core.mjs` | N/A — no live Google key; verify latLng core with mocked fetch | Revert change commit (RPC additive; drop via down migration) |

## Phase 1: Foundation (maps core + migration)

- [x] 1.1 Add `LatLngWaypoint` type + `computeOptimizedRouteLatLngCore` (latLng origin/destination/intermediates, round-trip, `DRIVE`, reuse field mask/validation) in `src/lib/maps/google-maps-core.ts`.
- [x] 1.2 Add key-gated `computeTechnicianRoute` wrapper (returns `null` when `GOOGLE_MAPS_SERVER_API_KEY` unset) in `src/lib/maps/google-maps.ts`.
- [x] 1.3 Create `supabase/migrations/20260828020000_enrich_job_coordinates_technician.sql`: `SECURITY DEFINER` RPC authorizing `can_access_job(auth.uid())`, `set_config('app.coordinate_enrichment', actor::text, true)` before UPDATE; revoke public execute, grant authenticated.
- [x] 1.4 Create `supabase/migrations/20260828030000_job_coordinate_enrichment_trigger.sql`: `create or replace validate_job_update()` adding a coordinate-enrichment carve-out gated by `app.coordinate_enrichment` (coordinate-only writes allowed, no other field changes).

## Phase 2: Core (query + action)

- [x] 2.1 Create `src/lib/jobs/technician-routing-queries.ts` — `getTechnicianRouteData()` returning RLS-visible pending set (`main_status='asignado'`, `archived_at is null`) + lat/lng, `deadline_date` asc (reuse `listTechnicianJobs`).
- [x] 2.2 Create `src/lib/jobs/technician-routing-actions.ts` — `optimizeTechnicianRoute`: `requireProfile` + `role==='tecnico'`, validate `jobIds` length-match RLS-visible set, enrich null-coords via RPC, call `computeTechnicianRoute`, apply `orderRouteRows`, return ordered + `skipped` + distance/duration or key-missing message.

## Phase 3: UI / wiring

- [x] 3.1 Create `app/trabajos/mi-ruta/page.tsx` — server page; `requireProfile()` + `tecnico` gate; load `getTechnicianRouteData()`, render client component.
- [x] 3.2 Create `src/components/jobs/technician-route.tsx` — client: geolocation states (denied/timeout/unavailable/unsupported), ordered list, per-leg Google Maps `dir` link, `skipped` list, key-missing message.
- [x] 3.3 Add nav item in `src/components/dashboard/technician-app-shell.tsx` + `mobile-bottom-nav.tsx` (grid-cols-5 → grid-cols-6); add `IconRoute` in `icons.tsx` (fallback `IconActivity`).

## Phase 4: Verification

- [x] 4.1 Create `scripts/verify-technician-route-core.mjs` — exercises latLng core with mocked fetch (mirror `scripts/verify-job-census-geocoding-core.mjs`).
- [x] 4.2 Run `npm run lint` and `npm run build`; fix type/lint errors.
- [x] 4.3 Manual QA: non-tecnico redirect, tampered jobIds rejection, key-missing, skipped list — DEFERRED (requires live Supabase + browser + `GOOGLE_MAPS_SERVER_API_KEY`; re-run after key provisioning).
