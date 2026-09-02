# Archive Report: technician-route

**Change**: `technician-route`
**Archived to**: `openspec/changes/archive/2026-08-28-technician-route/`
**Disposition**: `intentional-with-warnings`

## Gates

| Gate | Result | Evidence |
|------|--------|----------|
| Native Review Receipt Gate | PASS | `reviewGate` structurally ABSENT — no review was ever started for this candidate (kill switch off). Archive proceeds under ordinary repository policy. |
| Task Completion Gate | PASS | All 12 implementation tasks `[x]`. Task 4.3 "Manual QA" is marked DEFERRED (not unchecked) — requires live Supabase + browser + `GOOGLE_MAPS_SERVER_API_KEY`. |
| Verify report | PASS WITH WARNINGS | 0 CRITICAL, 0 blockers. 6/6 requirements, 13/13 scenarios. |

## Final State (at close — outranks intermediate snapshots)

- **Verdict**: PASS WITH WARNINGS — 0 CRITICAL, 0 blockers; 6/6 requirements, 13/13 scenarios.
- **Commands**: `node scripts/verify-technician-route-core.mjs` PASS (exit 0); `npm run lint` 0 errors (1 pre-existing unrelated warning in `manual-jobs-manager.tsx`); `npx tsc --noEmit` clean; `npm run build` success (`ƒ /trabajos/mi-ruta`).
- **Task 4.3 "Manual QA"**: DEFERRED (not failed). Requires live Supabase + browser + `GOOGLE_MAPS_SERVER_API_KEY`; re-run after key provisioning.
- **Migrations NOT yet applied to Supabase production**: `20260828010000_job_coordinates.sql`, `20260828020000_enrich_job_coordinates_technician.sql`, `20260828030000_job_coordinate_enrichment_trigger.sql`. Must be applied before the feature works.
- **Feature is inert** until `GOOGLE_MAPS_SERVER_API_KEY` is set (same as the existing admin planner).

## Post-Apply Correction (outranks the design's original wording)

The enrichment RPC sets `app.coordinate_enrichment` (NOT `app.job_assignment_mutation`), and `20260828030000` adds a matching `app.coordinate_enrichment`-gated carve-out to `validate_job_update`. This is the correct, final mechanism. The original design wording (decision 3: `app.job_assignment_mutation`) is superseded.

## Spec Sync

- **New capability** `technician-route` (new domain — no existing spec to merge).
- Copied `openspec/changes/technician-route/specs/technician-route/spec.md` → `openspec/specs/technician-route/spec.md` MECHANICALLY (byte-identical, 4424 bytes).
- No MODIFIED/REMOVED/RENAMED sections.

## Archive Move

- Moved `openspec/changes/technician-route` → `openspec/changes/archive/2026-08-28-technician-route/` mechanically (same-volume rename via `Move-Item`; source is untracked in git).
- Byte-identity verified: recursive snapshot vs. archived tree → empty diff (0 mismatches, 0 missing, 0 extra).
- Archived files: `proposal.md`, `design.md`, `exploration.md`, `tasks.md`, `verify-report.md`, `specs/technician-route/spec.md`.

## Mechanical Copy Contract Evidence

1. **Spec copy** (`openspec/specs/technician-route/spec.md`): byte comparison source vs. temp copy → `READBACK_DIFF_EMPTY: PASS (byte-identical)`, 4424 bytes.
2. **Archive move** (`openspec/changes/archive/2026-08-28-technician-route/`): recursive snapshot vs. archived tree → `(empty — no differences)`, `READBACK_RESULT: PASS (empty diff - byte-identical)` — 6/6 files, 0 mismatches, 0 missing, 0 extra.
3. **Cross-check** (archived source spec vs. main spec): `SPEC_DIFF: empty - byte-identical PASS`, 4424 bytes.

## Dependencies / Outstanding Items (not part of this change's archive)

- Pre-existing uncommitted work in the tree (free Census geocoder `census-geocoder-core.ts`, `jobs.latitude/longitude` columns, `enrichJobCoordinates`) was created earlier and is NOT part of this change's archive.
- 3 Supabase migrations pending application (listed above).
- `GOOGLE_MAPS_SERVER_API_KEY` provisioning pending.

## Warnings Carried Forward

1. Task 4.3 "Manual QA" DEFERRED (needs live Supabase + browser + key).
2. Minor design deviation (spec-compliant): `jobIds` uses subset validation, not strict length match.
3. 1 pre-existing lint warning in `manual-jobs-manager.tsx` (unused `currentUserId`) — outside this change.
