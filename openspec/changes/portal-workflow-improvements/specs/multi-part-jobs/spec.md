# Delta for multi-part-jobs

Conditional; unapproved [R08 part-copy gates](../../exploration.md#twelve-request-traceability).

## ADDED Requirements
### Requirement: Multi-type copying
MUST extend existing shared-field copies without coupling independent parts.

#### Scenario: New part
- GIVEN approved multi-type copying cases
- WHEN office adds a part
- THEN types match approved expectations; shared fields persist; assignment/finances remain independent.
