# Exploration: Technician Route (best route from GPS to pending jobs)

## Current State

- **Admin-only route planner** lives at `app/trabajos/ruta/page.tsx` + `src/components/jobs/route-planner.tsx`, gated by `requireAdmin()`. It optimizes a round-trip (`origin = destination = <origin placeId>`, `intermediates = job placeIds`) via `computeOptimizedRoundTrip` → `computeOptimizedRoundTripCore` → `POST https://routes.googleapis.com/directions/v2:computeRoutes` with `travelMode: DRIVE`, `optimizeWaypointOrder: true`, field mask `routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration`. It is currently **dead in practice** because `GOOGLE_MAPS_SERVER_API_KEY` is unset (`serverApiKey()` returns `""`, both `geocodeAddress` and `computeOptimizedRoundTrip` short-circuit to `unavailable`/`null`).
- **Free Census geocoding** (`geocodeAddressCensusCore`, key-less) resolves job addresses to `latitude`/`longitude`, stored on `jobs.latitude/longitude/coordinates_geocoded_at` (migration `20260828010000_job_coordinates.sql`). Populated best-effort on job create/update (`enrichCoordinatesBestEffort` in `src/lib/jobs/actions.ts`) and on admin route optimization (`optimizeJobRoute`).
- **Google Place IDs** (`jobs.google_place_id/geocoding_status/geocoded_at`, migration `20260823005000_job_route_planning.sql`) are the *paid* Google Geocoding path; most jobs are `pending`/`failed` because the key is unset. `google_place_id` is resolved lazily only inside `optimizeJobRoute` (admin).
- **Technician job list**: `app/trabajos/page.tsx` (technician branch) → `listTechnicianJobs` in `src/lib/jobs/queries.ts`, gated by `requireActiveShift()` and `requireActiveShiftPage()`. It queries `jobs` directly and relies on **RLS** ("Technicians can view assigned jobs" → `can_access_job(id)`, i.e. active assignment to the technician directly or via an active crew) to scope rows. It has an optional `status` filter but **no default status filter**, so it currently returns assigned jobs of *every* status.
- **Status model**: canonical `JobStatus` = `sin_asignar, asignado, en_revision, aprobado, facturado, pagado` (matches `types.ts`/`state.ts`). The DB enum still contains legacy values (`en_progreso`, `enviado_revision`, `listo_pagar`) but data was migrated away from them (migration `20260817011000`). A technician submits field work through the delivery editor → `main_status = 'en_revision'`; office can return `en_revision → asignado` for correction. So a technician's **pending (field work not yet delivered)** is exactly `main_status = 'asignado'`.
- **Shells**: technician *detail* page (`app/trabajos/[id]/page.tsx`) and `/manual` use `TechnicianAppShell` (has `MobileBottomNav`); the technician *list* page (`app/trabajos/page.tsx`) uses `FieldShell` (no bottom nav) — an existing inconsistency.

## Pending-Job Definition (verified)

`pending jobs for a technician` = jobs satisfying **all** of:
1. Assigned to the current technician (RLS `can_access_job`: active `job_assignments` row with `assignee_type='technician'` and `technician_id = auth.uid()`, OR `assignee_type='crew'` whose active crew includes the technician).
2. `main_status = 'asignado'` (field work in progress, not yet submitted to review).
3. `archived_at is null`.

Reuse: `listTechnicianJobs({ status: "asignado" })` already returns exactly this set (RLS + status filter + `archived_at is null` + `select("*")` which now includes `latitude`/`longitude`). No new RPC is strictly required for the read; a thin `getTechnicianRouteData()` wrapper (ordering by `deadline_date`, shaping `{ id, label, address, latitude, longitude }`) is cleaner and keeps the page decoupled.

Open product question: "for the day" — filter by `deadline_date` == today, or all pending assigned jobs? Recommend default = **all pending `asignado` jobs ordered by `deadline_date` asc**, with "today" as an optional refinement.

## Google API Call Shape (verified against `google-maps-core.ts`)

- **Origin MUST be `location.latLng`**, not `placeId`: browser geolocation yields raw coordinates; there is no reverse-geocode to placeId without an extra paid call.
- **Waypoints should use free Census `latitude`/`longitude`**, not Google `placeId`:
  - The origin is already latLng, so latLng waypoints are consistent.
  - `google_place_id` is mostly unresolved (paid geocoder, key unset) — the current blocker for the admin planner.
  - Census coordinates are already stored on `jobs` and are free/key-less.
- **Round-trip vs one-way**: Google's `optimizeWaypointOrder` treats origin+destination as *fixed* and only reorders intermediates. A true one-way "end at the last job" cannot be expressed without fixing the destination, which is what we're optimizing. Recommendation: **round-trip shape** `origin = destination = current GPS`, `intermediates = all job latLngs`, then present the optimized intermediate order as the visit order (optionally suppress the return-to-start leg in the UI). This mirrors the admin planner and needs no new API semantics.
- **Reuse vs new core**: do NOT reuse `computeOptimizedRoundTripCore` (it is placeId-typed and round-trip-only). Add a **new core** `computeOptimizedRouteLatLngCore(origin, destination, intermediates, apiKey, …)` in `src/lib/maps/google-maps-core.ts` that sends `location.latLng` waypoints and reuses the same field mask, `requestJson`, and `optimizedIntermediateWaypointIndex` validation; add a key-gated wrapper in `src/lib/maps/google-maps.ts`. Reuse existing `orderRouteRows` + `normalizeRouteJobIds` from `src/lib/jobs/route-planning-core.ts` for ordering/validation.

## Geolocation

- `navigator.geolocation.getCurrentPosition` (client-side, free, requires HTTPS or localhost). Must be requested from a client component. Handle: permission denied, timeout, position unavailable, and browsers without geolocation. Recommend a clear "Usar mi ubicación" button with an error state; no server-side geocoding of the origin.

## UI Location (recommended)

- Admin already owns `/trabajos/ruta`. Give the technician a **dedicated page `/trabajos/mi-ruta`** wrapping a new client component `src/components/jobs/technician-route.tsx` (geolocation + optimize + ordered result list).
- Entry point: add a nav item to `NAV_ITEMS` in `technician-app-shell.tsx` **and** `mobile-bottom-nav.tsx` (note: bottom nav is `grid-cols-5`; adding a 6th item requires `grid-cols-6`). Alternatively add a "Ruta" button on the technician `/trabajos` list; given the mobile-first field use-case, a dedicated page is preferred. Shell choice: use `FieldShell` (consistent with the list page) or `TechnicianAppShell` (bottom nav); flag the existing shell inconsistency for a separate cleanup.

## Affected Files

**New**
- `src/lib/maps/google-maps-core.ts` — add `LatLngWaypoint` type + `computeOptimizedRouteLatLngCore`.
- `src/lib/maps/google-maps.ts` — add `computeTechnicianRoute` wrapper (key-gated).
- `src/lib/jobs/technician-routing-queries.ts` — `getTechnicianRouteData()` (pending `asignado` jobs + `latitude/longitude`).
- `src/lib/jobs/technician-routing-actions.ts` — `optimizeTechnicianRoute({ jobIds, origin })` (technician-scoped, validates jobIds against RLS-visible rows, calls compute + `orderRouteRows`, revalidates).
- `src/components/jobs/technician-route.tsx` — client component (geolocation + result).
- `app/trabajos/mi-ruta/page.tsx` — server page (profile/role gate + load data).

**Modified**
- `src/components/dashboard/technician-app-shell.tsx` — add nav item.
- `src/components/dashboard/mobile-bottom-nav.tsx` — add nav item (grid → `grid-cols-6`).
- (optional) `src/lib/jobs/types.ts` — `latitude`/`longitude`/`coordinates_geocoded_at` already present; no change needed for latLng routing.

## Gaps / Risks

1. **Technicians cannot write `latitude`/`longitude`**: the `validate_job_update` trigger (latest in `20260817012000_job_state_machine_and_permissions.sql`) restricts technician column writes to a whitelist (`main_status`, `incident`, `comments`, `delivered_pdf_*`, …). `enrichJobCoordinates` writes `latitude/longitude/coordinates_geocoded_at`, so on-demand enrichment from a technician-scoped server action will be **rejected**. Mitigation options: (a) add a `SECURITY DEFINER` RPC for coordinate enrichment that internally authorizes `can_access_job(actor)`, or (b) skip on-demand enrichment and rely on office-side population (create/update/assign) + graceful handling of null-coordinate jobs in the technician UI. Recommend (a) for robustness.
2. **Jobs with missing coordinates**: Census geocoding is best-effort; some `asignado` jobs will have `latitude`/`longitude = null`. The route action must exclude them and surface a clear list rather than failing the whole route.
3. **`GOOGLE_MAPS_SERVER_API_KEY` still unset**: the entire route call returns `null` until the key is configured (same as admin planner). Feature will be inert until the key lands — confirm key provisioning is tracked separately.
4. **Permission boundary**: use `requireProfile()` + role check (`role === "tecnico"`) + RLS, mirroring `listTechnicianJobs`. `requireActiveShift` is effectively a no-op now (shifts were made optional in `20260814020000_make_technician_shifts_optional.sql`) — do not treat it as the authorization boundary.
5. **Stale enum label**: `job_route_candidates` view still references legacy `'en_progreso'`; the technician flow should use the canonical `'asignado'` and avoid copying that stale filter.
6. **Client-supplied `jobIds` trust**: validate every id against the RLS-visible pending set (length match) so a technician cannot route jobs outside their assignment.

## Recommendation Summary

1. Pending set = RLS-scoped `main_status='asignado'` + `archived_at is null` (reuse `listTechnicianJobs({ status: "asignado" })`).
2. New latLng-based core (`computeOptimizedRouteLatLngCore`) with round-trip shape `origin = destination = current GPS`, intermediates = Census `latLng`; reuse `orderRouteRows`.
3. Dedicated page `/trabajos/mi-ruta` + client component requesting `navigator.geolocation`; add nav item (and bottom-nav grid fix).
4. Add a `SECURITY DEFINER` coordinate-enrichment RPC (or gracefully skip null-coordinate jobs) because the technician trigger whitelist blocks direct coordinate writes.

## Ready for Proposal

Yes — recommend `sdd-propose`, with one product clarification to confirm ("for the day" = all pending vs `deadline_date == today`) and one dependency note (`GOOGLE_MAPS_SERVER_API_KEY` provisioning).
