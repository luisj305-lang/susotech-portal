# Design: Technician Route (GPS → pending jobs)

## Technical Approach

Server page (`app/trabajos/mi-ruta/page.tsx`) loads the pending set via `getTechnicianRouteData()` (reuses `listTechnicianJobs({ status: "asignado" })`, `deadline_date` asc). A client component requests `navigator.geolocation`, then calls `optimizeTechnicianRoute({ jobIds, origin })`. The action re-authorizes, validates `jobIds` against the RLS-visible pending set (length match), enriches null coordinates via a `SECURITY DEFINER` RPC, calls `computeTechnicianRoute` (latLng core), and applies `orderRouteRows`. Missing key → clear "unavailable" message.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| (1) Reuse `computeOptimizedRoundTripCore` (placeId-typed) | Origin is raw GPS latLng; placeId would need a paid reverse-geocode; round-trip-only shape | **New `computeOptimizedRouteLatLngCore`** + key-gated `computeTechnicianRoute` wrapper. Round-trip `origin=destination=GPS`, `intermediates=job latLng`, `optimizeWaypointOrder`, `DRIVE`, same field mask + `requestJson`. |
| (2) Authorize query/action via `requireActiveShift` only | Shift is now optional (no-op boundary); doesn't enforce role | **`requireProfile()` + `role === "tecnico"`** in page and action; `jobIds` validated by length match against RLS-visible set (mirrors admin `optimizeJobRoute`). |
| (3) Enrich coordinates via direct `supabase.update` | `validate_job_update` trigger whitelist blocks technician writes to `latitude/longitude/coordinates_geocoded_at` | **`SECURITY DEFINER` RPC `enrich_job_coordinates_technician`** authorizing `can_access_job(auth.uid())` before the `UPDATE`, mirroring `create_job_part`/`assign_jobs_atomic` + `set_config('app.job_assignment_mutation', actor::text, true)`. |
| (4) Fail route on null-coordinate jobs | One bad address kills the whole route | **Exclude null-coordinate jobs**, return separate `skipped` list surfaced in UI. |
| (5) Crash when key unset | Feature must be inert, not fatal | `computeTechnicianRoute` returns `null` when `GOOGLE_MAPS_SERVER_API_KEY` unset; action maps to clear message. |
| (6) Reuse admin route UI | Admin page is `requireAdmin`, placeId-based | **New** `/trabajos/mi-ruta` + `technician-route.tsx`; nav item in both shells (`grid-cols-6`). |

## Data Flow

```
page (server) ──getTechnicianRouteData()──▶ pending jobs (RLS: can_access_job, asignado, archived_at null)
client ──navigator.geolocation──▶ { lat, lng }
client ──optimizeTechnicianRoute({ jobIds, origin })──▶
  requireProfile(tecnico) ─▶ validate jobIds == RLS-visible set
    ─▶ enrich_job_coordinates_technician RPC (null-coord jobs) ──▶ skipped[]
    ─▶ computeTechnicianRoute(origin, latLngs) ──▶ optimizeWaypointOrder
    ─▶ orderRouteRows ─▶ ordered jobs + distance/duration
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/lib/maps/google-maps-core.ts` | Modify | `LatLngWaypoint` type + `computeOptimizedRouteLatLngCore` (latLng origin/destination/intermediates, round-trip, DRIVE, same field mask/validation). |
| `src/lib/maps/google-maps.ts` | Modify | `computeTechnicianRoute` key-gated wrapper (`null` if key unset). |
| `src/lib/jobs/technician-routing-queries.ts` | Create | `getTechnicianRouteData()` → pending jobs + `latitude/longitude`, `deadline_date` asc. |
| `src/lib/jobs/technician-routing-actions.ts` | Create | `optimizeTechnicianRoute({ jobIds, origin })` — authorize, validate, enrich, compute, order. |
| `src/components/jobs/technician-route.tsx` | Create | Client: geolocation states (denied/timeout/unavailable/unsupported), ordered list, "open in Google Maps" per leg, `skipped` list, key-missing message. |
| `app/trabajos/mi-ruta/page.tsx` | Create | Server page; `requireProfile()` + `tecnico` gate; renders `technician-route.tsx`. |
| `src/components/dashboard/technician-app-shell.tsx` | Modify | Add nav item (needs new `IconRoute` in `icons.tsx`, fallback `IconActivity`). |
| `src/components/dashboard/mobile-bottom-nav.tsx` | Modify | Add nav item; `grid-cols-5` → `grid-cols-6`. |
| `supabase/migrations/YYYYMMDDHHMMSS_enrich_job_coordinates_technician.sql` | Create | `SECURITY DEFINER` RPC + revoke/grant. |

## Interfaces / Contracts

```ts
// google-maps-core.ts
type LatLngWaypoint = { latitude: number; longitude: number };
computeOptimizedRouteLatLngCore(
  origin: LatLngWaypoint, destination: LatLngWaypoint,
  intermediates: LatLngWaypoint[], apiKey: string,
  fetchImpl?, timeoutMs?
): Promise<OptimizedRoute | null>  // OptimizedRoute reuse

// technician-routing-actions.ts
type OptimizeTechnicianRouteResult =
  | { success: true; orderedJobs: { id; label; address; lat; lng }[]; skipped: { id; label }[]; distanceMeters: number; duration: string }
  | { success: false; message: string };
```

```sql
-- SECURITY DEFINER, search_path=''
create function public.enrich_job_coordinates_technician(
  p_job_id uuid, p_latitude double precision, p_longitude double precision
) returns void -- authorizes can_access_job(auth.uid()); sets app.job_assignment_mutation before UPDATE
```

## Testing Strategy

No test runner (config: `strict_tdd: false`). Verify via `npm run lint` + `npm run build` + manual QA.

| Layer | What to Test | Approach |
|---|---|---|
| Type/compile | New core, action, query, page | `npm run build` |
| Lint | All touched files | `npm run lint` |
| Manual | Geolocation states; skipped list; key-missing; non-tecnico redirect; tampered jobIds rejection | Browser + Supabase local |

## Threat Matrix

`N/A` — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Additive migration (RPC only); no enum/state changes. Rollback = revert commit; drop RPC via down migration if desired. Feature inert until `GOOGLE_MAPS_SERVER_API_KEY` set.

## Open Questions

- [ ] Icon: no `IconRoute` exists in `icons.tsx` — add one, or reuse `IconActivity`?
