# job-work-types Specification

## Purpose
Conditional dispatch; unapproved [R05/R08 display/catalog/write gates](../../exploration.md#twelve-request-traceability).

## Requirements
### Requirement: Multiple types
MUST support multiple types on one job in admin “Asignación y estado” and technician views, without implying tariffs/parts.

Requested labels: Aerial splicing; Underground splicing; Riser; Aerial construcción; Pull fiber/coax; PT; Lash/case/tap; DeRe; Wreckout; Nuevo Projecto.

#### Scenario: Round-trip
- GIVEN two types and approved catalog/legacy/write cases
- WHEN creating/importing/editing/assigning types
- THEN selected types remain technician-visible; unknown legacy values survive.

#### Scenario: Failed write
- GIVEN approved duplicate/concurrent/failed-write expectations
- WHEN saving types
- THEN outcomes match approved atomicity policy without legacy loss.
