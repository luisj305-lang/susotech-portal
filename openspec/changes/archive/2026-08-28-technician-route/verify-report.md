```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:ba69282386a866ecd6f509fadf563c737d601898bf276957d6a4b5579cf36f30
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 6/6
scenarios: 13/13
test_command: node scripts/verify-technician-route-core.mjs
test_exit_code: 0
test_output_hash: sha256:18188ff044ab53c3d526916c1b91a4ff610cd2a0018ac980338a56c74273251a
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:b9977d4368e0f36f985a25e3838c8efc0451b25dbec7811a29feb5eda1c0bcd1
```

## Verification Report

**Change**: technician-route
**Version**: N/A
**Mode**: Standard

> **Count note**: The launch status stated "6 requirements, 15 scenarios", but the retrieved spec
> (`openspec/changes/technician-route/specs/technician-route/spec.md`) contains **6 requirements and 13
> scenarios** (verified by direct grep: 6 `### Requirement:` and 13 `#### Scenario:` lines). The envelope
> uses the actual spec counts (6/6, 13/13), per the hard rule "count from the retrieved specs, never invent
> totals." Flagging this for the orchestrator to correct the status.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 12 |
| Tasks complete | 11 |
| Tasks incomplete | 1 (4.3 Manual QA — DEFERRED, cleanup task) |

Task 4.3 "Manual QA" (non-tecnico redirect, tampered jobIds, key-missing, skipped list) is deferred: it
requires a live Supabase + browser AND `GOOGLE_MAPS_SERVER_API_KEY`, which the user will provide in a later
session. It is a cleanup/verification task, not a core implementation task → WARNING (not a blocker).

### Build & Tests Execution

**Build** (`npm run build`): ✅ Passed (exit 0)
```text
> next build
▲ Next.js 16.3.0 (Turbopack)
✓ Compiled successfully in 3.7s
  Running TypeScript ... Finished TypeScript in 3.0s
✓ Generating static pages using 7 workers (25/25)
ƒ /trabajos/mi-ruta   (dynamic, server-rendered on demand)
```

**Type-check** (`npx tsc --noEmit`): ✅ Passed (exit 0, empty output)

**Lint** (`npm run lint`): ✅ Passed (exit 0; 1 pre-existing warning, unrelated to this change)
```text
src/components/manual-jobs/manual-jobs-manager.tsx
  65:3  warning  'currentUserId' is defined but never used
✖ 1 problem (0 errors, 1 warning)
```

**Tests** (`node scripts/verify-technician-route-core.mjs`): ✅ Passed (exit 0)
```text
[technician-route-core] PASS
```
(Exercises `computeOptimizedRouteLatLngCore` with a mocked `fetch`: round-trip latLng origin/destination,
`optimizeWaypointOrder`, `DRIVE`, field mask; plus invalid-origin / empty-intermediates / missing-key /
server-error / invalid-index guards.)

**Coverage**: ➖ Not available (no test runner configured; `strict_tdd: false`)

### Spec Compliance Matrix

> No automated runtime test runner exists in this repo (design Testing Strategy: `lint` + `build` + manual
> QA). Spec scenarios are therefore verified by **source inspection** plus the mocked core script; this is
> recorded honestly as a SUGGESTION below, not a hidden PASS. "Result" uses the canonical statuses; a runtime
> pass exists only where a covering test was actually executed.

| # | Requirement | Scenario | Implementation | Runtime test | Result |
|---|-------------|----------|----------------|--------------|--------|
| R1 | Conjunto de trabajos pendientes | Técnico consulta sus pendientes | `technician-routing-queries.ts` `getTechnicianRouteData()` → `listTechnicianJobs({status:"asignado"})` (`queries.ts:87`, RLS + `archived_at is null` + `deadline_date` asc) | none | ✅ VERIFIED (source) |
| R1 | Conjunto de trabajos pendientes | Trabajos ajenos excluidos | RLS `can_access_job` via direct `jobs` select in `listTechnicianJobs` | none | ✅ VERIFIED (source) |
| R2 | Ubicación actual del técnico | Permiso concedido | `technician-route.tsx` `requestLocation` → `getCurrentPosition` success → origin + action | none | ✅ VERIFIED (source) |
| R2 | Ubicación actual del técnico | Permiso denegado | `technician-route.tsx` `PERMISSION_DENIED` → `denied` + message | none | ✅ VERIFIED (source) |
| R2 | Ubicación actual del técnico | Geolocalización no disponible | `technician-route.tsx` unsupported + `TIMEOUT`/`unavailable` states | none | ✅ VERIFIED (source) |
| R3 | Cálculo de ruta optimizada | Ruta optimizada calculada | `google-maps-core.ts` `computeOptimizedRouteLatLngCore` + `google-maps.ts` wrapper + `orderRouteRows` | `scripts/verify-technician-route-core.mjs` (core only) | ⚠️ PARTIAL (core runtime-tested; action/UI path source-inspected) |
| R3 | Cálculo de ruta optimizada | Trabajos sin coordenadas | `technician-routing-actions.ts` null-coord → enrich-or-skip → `skipped[]`; UI "Trabajos sin ubicar" | none | ✅ VERIFIED (source) |
| R4 | Autorización | Acceso correcto | `mi-ruta/page.tsx` `requireRole("tecnico")`; action `requireProfile()` + role check | none | ✅ VERIFIED (source) |
| R4 | Autorización | Rol no autorizado | `requireRole("tecnico")` → `redirect("/acceso-denegado")`; action returns "No autorizado." | none | ✅ VERIFIED (source) |
| R4 | Autorización | jobIds manipulados | `technician-routing-actions.ts` validates every id ∈ RLS-visible pending set | none | ✅ VERIFIED (source) |
| R5 | Clave de Google ausente | Clave ausente | `google-maps.ts` `computeTechnicianRoute` → `null` when key unset; action early `serverApiKey()` → clear message | none | ✅ VERIFIED (source) |
| R6 | Enriquecimiento de coordenadas | Enriquecimiento exitoso | action `geocodeAddressCensusCore` → `supabase.rpc("enrich_job_coordinates_technician")` (SECURITY DEFINER, migration `20260828020000`; sets `app.coordinate_enrichment`) | none | ✅ VERIFIED (source) |
| R6 | Enriquecimiento de coordenadas | Enriquecimiento no disponible | action catch/skip → `skipped[]`, never fatal | none | ✅ VERIFIED (source) |

**Compliance summary**: 0/13 scenarios have an automated runtime test covering the full scenario; 13/13 are
implemented and verified by source inspection; the core route-computation logic additionally has runtime
evidence via the mocked core script. The runtime-coverage gap is recorded as a SUGGESTION.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Conjunto de trabajos pendientes | ✅ Implemented | Reuses RLS-scoped `listTechnicianJobs({status:"asignado"})`; `archived_at is null` + `deadline_date` asc confirmed in `queries.ts`. |
| Ubicación actual del técnico | ✅ Implemented | Four geolocation states (permission/denied/timeout/unavailable + unsupported) handled in client component. |
| Cálculo de ruta optimizada | ✅ Implemented | latLng core mirrors admin core (field mask, `requestJson`, index validation); null-coord jobs excluded + surfaced. |
| Autorización | ✅ Implemented | Role gate in page + action; `jobIds` subset-validated against RLS-visible pending set. |
| Clave de Google ausente | ✅ Implemented | Key-gated wrapper returns `null`; action returns a clear "unavailable" message before any Google call. |
| Enriquecimiento de coordenadas | ✅ Implemented | Free Census geocode → SECURITY DEFINER RPC persists coords; failure → `skipped` (non-fatal). |

### Coherence (Design)

| # | Design decision | Followed? | Notes |
|---|-----------------|-----------|-------|
| 1 | New `computeOptimizedRouteLatLngCore` + key-gated `computeTechnicianRoute` wrapper | ✅ Yes | `google-maps-core.ts:115` + `google-maps.ts:22`; round-trip `origin=destination=GPS`, `DRIVE`, `optimizeWaypointOrder`, same field mask. |
| 2 | `requireProfile()` + `role === "tecnico"`; `jobIds` length-match vs RLS-visible set | ⚠️ Partial | Role gate ✅. `jobIds` uses a **subset** check (`every id ∈ pending set`), not a strict length match (admin uses `data.length !== jobIds.length`). Spec-compliant (still rejects non-RLS-visible ids); minor deviation from the design's "length match" wording. |
| 3 | SECURITY DEFINER RPC `enrich_job_coordinates_technician` + trigger carve-out | ✅ Yes | RPC sets `app.coordinate_enrichment` (NOT `app.job_assignment_mutation`); trigger `20260828030000` carve-out gated by `app.coordinate_enrichment`, coordinate-only writes. |
| 4 | Exclude null-coordinate jobs + separate `skipped` list | ✅ Yes | `skipped[]` returned by action and rendered as "Trabajos sin ubicar". |
| 5 | Key unset → `null` + clear message (inert, not fatal) | ✅ Yes | `computeTechnicianRoute` returns `null`; action short-circuits with message. |
| 6 | Dedicated `/trabajos/mi-ruta` + nav item in both shells (`grid-cols-6`) | ✅ Yes | `page.tsx`, `technician-route.tsx`, nav in `technician-app-shell.tsx` + `mobile-bottom-nav.tsx` (`grid-cols-6`), `IconRoute` in `icons.tsx`. |

**Trigger carve-out confirmation**: `20260828030000_job_coordinate_enrichment_trigger.sql` adds the
`app.coordinate_enrichment`-gated carve-out (coordinate-only writes allowed) and `20260828020000_enrich_job_coordinates_technician.sql`
sets `app.coordinate_enrichment` (line 47) — **not** `app.job_assignment_mutation`. ✅ Confirmed correct.

### Issues Found

**CRITICAL**: None

**WARNING**:
1. Task 4.3 "Manual QA" is DEFERRED (cleanup task; needs live Supabase + browser + `GOOGLE_MAPS_SERVER_API_KEY`). Not a core-implementation blocker.
2. Design deviation (minor): decision (2) specifies a strict `jobIds` length match; implementation uses subset validation (`every id ∈ pending set`). Still rejects tampered ids — no security gap, spec-compliant.
3. `npm run lint` reports 1 pre-existing warning in `manual-jobs-manager.tsx` (unused `currentUserId`) — outside this change's touched files.

**SUGGESTION**:
1. No automated runtime test runner covers the spec scenarios (repo has no test runner). Consider adopting one (e.g. Vitest) to cover the action/query/component layers beyond the existing mocked core script.
2. Live Google Routes call is inert until `GOOGLE_MAPS_SERVER_API_KEY` is provisioned (tracked separately); end-to-end route behavior remains unexercised.
3. Running the `.mjs` verify script emits a `MODULE_TYPELESS_PACKAGE_JSON` warning (package.json lacks `"type": "module"`); harmless but noisy — could add the field or a loader.

### Verdict

**PASS WITH WARNINGS**

All 6 requirements and 13 scenarios are implemented and coherent with the design; build, type-check, lint,
and the mocked latLng-core script all pass (exit 0). No CRITICAL findings or blockers. Warnings are limited
to the deferred manual-QA task, a minor spec-compliant design deviation, and a pre-existing unrelated lint
warning; suggestions cover the project-wide absence of a runtime test runner and the pending Google API key.
