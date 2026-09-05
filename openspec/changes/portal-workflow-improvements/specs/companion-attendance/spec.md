# companion-attendance Specification

## Purpose
Conditional presence; unapproved [R09 authority/lifecycle/vehicle/fuel gates](../../exploration.md#twelve-request-traceability).

## Requirements
### Requirement: Companions
MUST record authorized companions at every shift start without granting assignment/access/money or multiplying fuel attribution.

#### Scenario: Start
- GIVEN approved companion/solo/concurrency cases
- WHEN starting shifts
- THEN companions appear active under approved lifecycle rules.

#### Scenario: Unauthorized attestation
- GIVEN unauthorized actor
- WHEN recording companions
- THEN reject without attendance/access/financial changes.
