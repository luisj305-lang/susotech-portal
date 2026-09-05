# job-queue Specification

## Purpose
Queue planning. All eight specs: scenarios conditional, NOT implementation-approved. Gates incorporate complete unapproved [exploration prerequisite rows](../../exploration.md#twelve-request-traceability).

## Requirements
### Requirement: R01/R02/R03/R04/R06 queue
MUST preserve RLS, office accounting, routes, independent/visible parts and audit. Editable/update dates MUST NOT substitute for assignment events. “revisados” MUST NOT automatically mean `en_revision`.

#### Scenario: Filters
- GIVEN approved R01 screens/controls
- WHEN one filter interaction occurs
- THEN results update without Apply, preserving search/URL/back behavior.

#### Scenario: Assignment provenance
- GIVEN approved R02 event/legacy/timezone/layout cases
- WHEN technician opens job
- THEN top-right display below assigned indication matches audited-event or approved missing-history expectations.

#### Scenario: Presentation
- GIVEN approved R03/R04/R06 tab/state/priority/mixed-part/financial-only cases
- WHEN technician opens queue
- THEN approved/“revisados” occupy second tab; assigned work has approved priority; labels are “Asignado”, “En revisión”, “Aprobado”.
