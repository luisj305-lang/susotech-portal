# Delta for job-lifecycle

Conditional; unapproved [R11 submission/version/timezone/legacy gates](../../exploration.md#twelve-request-traceability).

## ADDED Requirements
### Requirement: PDF delivery provenance
MUST show actual version-qualified technician submission time when available beside admin delivered-PDF section in “En revisión”.

#### Scenario: Version history
- GIVEN approved submission/redelivery/regeneration/missing-history cases
- WHEN admin reviews PDF
- THEN display qualified submission evidence, never substitute regeneration/update/approval time; allocations remain unchanged.
