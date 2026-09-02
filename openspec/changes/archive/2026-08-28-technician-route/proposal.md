# Proposal: Technician Route (GPS → pending jobs)

## Intent

Technicians need, on-device, the best driving route from their current GPS position to visit all pending field jobs. No technician route exists today; the admin planner is admin-only and inert without a Google API key.

## Scope

### In Scope
- Page `/trabajos/mi-ruta` gated by `requireProfile()` + role `tecnico`.
- Client component using `navigator.geolocation` (permission/denied/timeout/unavailable states).
- Pending set = RLS-scoped `main_status='asignado'` + `archived_at is null`, ordered `deadline_date` asc.
- New latLng Google Routes core + key-gated wrapper (round-trip `origin=destination=GPS`, `intermediates=job lat/lng`, `optimizeWaypointOrder`, `DRIVE`); reuse `orderRouteRows`/`normalizeRouteJobIds`.
- `SECURITY DEFINER` coordinate-enrichment RPC, or graceful skip of null-coordinate jobs.
- Nav items in `technician-app-shell.tsx` and `mobile-bottom-nav.tsx` (`grid-cols-6`).
- Clear "API key missing" message.

### Out of Scope
- `deadline_date == today` filter (all pending assigned is the default; optional later).
- Un-blocking the admin planner; Google Place ID geocoding.
- Shell consistency cleanup; origin reverse-geocoding.

## Capabilities

### New Capabilities
- `technician-route`: technician GPS→pending-jobs optimized route (geolocation, pending query, latLng compute, enrichment RPC, nav entry, key-missing state).

### Modified Capabilities
- None. Consumed read-only: `job-lifecycle`, `role-based-route-guard`, `multi-part-jobs`.

## Approach

Server page loads pending jobs via `getTechnicianRouteData()` (reuses `listTechnicianJobs({status:"asignado"})`, `deadline_date` asc). Client requests geolocation, then calls `optimizeTechnicianRoute` (server action) which validates `jobIds` against the RLS-visible pending set, enriches null coordinates (SECURITY DEFINER RPC), calls `computeOptimizedRouteLatLngCore`, applies `orderRouteRows`. Missing key short-circuits with a message.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/lib/maps/google-maps-core.ts` | Modified — `LatLngWaypoint` + `computeOptimizedRouteLatLngCore` |
| `src/lib/maps/google-maps.ts` | Modified — `computeTechnicianRoute` wrapper |
| `src/lib/jobs/technician-routing-queries.ts` | New — `getTechnicianRouteData()` |
| `src/lib/jobs/technician-routing-actions.ts` | New — `optimizeTechnicianRoute()` |
| `src/components/jobs/technician-route.tsx` | New — client geolocation + result |
| `app/trabajos/mi-ruta/page.tsx` | New — server page + gate |
| `src/components/dashboard/{technician-app-shell,mobile-bottom-nav}.tsx` | Modified — nav items |
| Supabase migration | New — SECURITY DEFINER enrichment RPC |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Null-coordinate jobs | Med | Enrich via RPC; else exclude + surface |
| `jobIds` tampering | Low | Validate ids == RLS-visible pending set |
| Key missing (inert) | High | Key-gated + explicit message; track provisioning |
| Geolocation failure | Med | Permission/timeout/unavailable states |

## Rollback Plan

Revert the change commit. No enum/state changes; the RPC and enrichment writes are additive (drop via down migration if desired). Restore prior nav items.

## Dependencies

- `GOOGLE_MAPS_SERVER_API_KEY` provisioning (Google Routes API), tracked separately; feature inert until set.

## Success Criteria

- [ ] Technician sees optimized visit order for all pending `asignado` jobs.
- [ ] Route uses Census lat/lng via Google Routes output.
- [ ] Null-coordinate jobs enriched or surfaced, never fatal.
- [ ] Non-`tecnico` and non-RLS-visible jobs inaccessible.
- [ ] Missing key shows clear message, no crash.
