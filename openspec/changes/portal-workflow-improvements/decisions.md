# Decisions: Portal Workflow Improvements

Recorded 2026-09-05 from the maintainer. These govern implementation; they are product approvals, not delivery authorization (no commit/push/PR/deploy implied).

| ID | Decision |
|----|----------|
| R01 | Whole-portal one-touch filters via chips. Date-range filters (produccion/historicos) use quick preset ranges at the implementer's discretion. |
| R02 | Every job has an assignment. Show the audited assignment date; if a job has no assignment record, hide the date entirely. Interpreted as the current/latest active assignment event (`job_assignments.assigned_at`). |
| R03 | Second technician tab = already-reviewed work. `en_revision` (awaiting review) stays in the first/active view, NOT in the reviewed tab. |
| R04 | Technician sees exactly three operational states: Asignado / En revisión / Aprobado. `facturado`/`pagado` remain hidden from technicians (office keeps them). |
| R06 | Technician queue ordered by priority as a list (assigned-first). Status chips remain as filters alongside. |
| R05/R08 | The ten supplied work types are the COMPLETE catalog. A job must have at least one type. Legacy free-text `job_type` values are left as-is (no migration). |
| R09 | Companion recording is the technician's responsibility. Immediate, no confirmation from companions. |
| R10 | Weekly export shows the total amount AND each participant's share (repartition); those two should reconcile. "Coworkers" = financial participants (delivery participants), NOT attendance companions. Format at implementer's discretion. |
| R11 | Show the LATEST delivered version's submission date. |
| R12 | Royal-blue default applies to borders and arrows ("bordes y las flechas"). Text remains black. Exact shade at implementer's discretion (blue `#2563eb` available in palette). |
| R07 | Surface identified: the PDF viewer when opening a job to review the work. Root cause still unreproduced pending device/browser/screenshot evidence. |

## Interpretation notes (flagging, not silently deciding)
- R02: "latest vs original" was not explicitly chosen; "current/latest active assignment" is the natural reading of "every job has an assignment" and is documented here for correction.
- R06: "priority order" is interpreted as assigned-first (most recent assignment first), then deadline ascending; returned corrections and overdue items surface within that ordering.
- R10: format left to implementer (document export; PDF/CSV chosen during design).
- R12: "bordes y las fechas" read as "bordes y las flechas" (borders + arrows); code annotations contain no date concept.

## Verification environment
The maintainer authorized using the real Supabase environment and trusts the implementation. Receipt-driven development (review mode) remains OFF (user-owned switch, off by default); verification uses available means (lint/build now, runtime in verify phase).
