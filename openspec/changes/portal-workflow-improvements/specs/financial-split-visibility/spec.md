# Delta for financial-split-visibility

Conditional; unapproved [R10 format/amount/currency/coworker/source/period gates](../../exploration.md#twelve-request-traceability). R09 dependency only for attendance coworkers. Allocation-estimate drift remains unresolved.

## ADDED Requirements
### Requirement: Previous-week export
MUST export PRISM, amount, coworkers and earned percentage within existing authorization. MUST NOT claim immutable historical statements.

#### Scenario: Reconciliation
- GIVEN approved source/period/empty-week cases
- WHEN technician exports
- THEN four fields reconcile to authorized records without duplicated parts.

#### Scenario: Unauthorized export
- GIVEN inactive or unauthorized technician
- WHEN requesting others’ data
- THEN deny disclosure, including coworkers’ money.
