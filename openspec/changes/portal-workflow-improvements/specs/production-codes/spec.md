# Delta for production-codes

Conditional; unapproved [R12 shade/text/border/arrow/line/legacy gates](../../exploration.md#twelve-request-traceability).

## ADDED Requirements
### Requirement: Annotation default
MUST default new annotations to approved “azul rey”, preserving existing colors.

#### Scenario: New annotation
- GIVEN approved shade/scope
- WHEN adding annotations
- THEN preview/final defaults match approval.

#### Scenario: Legacy
- GIVEN old colorless/explicit-color drafts
- WHEN reopening/rendering
- THEN original colors remain unchanged.
