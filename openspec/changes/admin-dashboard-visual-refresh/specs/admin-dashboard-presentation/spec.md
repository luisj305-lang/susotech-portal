# Administrator Dashboard Presentation Specification

## Purpose

Apply the [proposal](../../proposal.md) and [invariants](../../exploration.md). Planning only: implementation requires final chat confirmation of proposal/spec/design/tasks together. Later checks require synthetic data isolated at server and browser boundaries, never live production access.

## Requirements

### Requirement: Scope

The refresh MUST opt in only for administrator `/dashboard`; supervisors, technicians, other administrator routes, other capabilities, authorization, global styling, and shared loading/error boundaries MUST remain unchanged. Database/schema/query/math/state changes, new metrics/date pickers/routes, and existing `/equipos` redirect or timezone-fallback fixes are excluded.

#### Scenario: Isolation
- GIVEN administrator, supervisor, and technician sessions
- WHEN visiting dashboards and another administrator route
- THEN only administrator `/dashboard` receives the refresh; existing permissions remain effective.

#### Scenario: Approval gate
- GIVEN appearance approval only
- WHEN the complete plan is presented in chat
- THEN implementation MUST await final user confirmation.

### Requirement: Hierarchy

The surface MUST match approved hierarchy, spacing, and colors: compact navy navigation/light header, weekly controls → four existing KPIs → full-width pending grid → full-width ten-column table → five quick actions.

#### Scenario: Reference
- GIVEN loaded records at 1600×1100 or wider
- WHEN displayed
- THEN height follows content; preserve branding and real profile, never fictional records/badges or three/six-row caps.

### Requirement: Values and weeks

The dashboard MUST preserve financial sources, calculations, units, precision, invoice cents/100, allocated earnings cents/100, and server-provided active flags rather than browser-inferred status.

#### Scenario: Week navigation
- GIVEN Friday/Thursday or DST boundaries
- WHEN previous/next changes one week or current resets offset
- THEN retain America/New_York server Friday 00:00→next Friday exclusive, Friday→Thursday display, selected-week wording, and current-week link only at nonzero offset.

### Requirement: Pending preview

The preview MUST preserve first-eight-loaded nonarchived review jobs, updated-descending ordering, week independence, view-all, photo counts, review status, PDF pending/current/stale states, and job-detail review destinations.

#### Scenario: Preview sizes
- GIVEN 0/1/3/8/9 loaded pending jobs covering every PDF state
- WHEN changing week
- THEN display 0/1/3/8/8 respectively, wrapping without global-backlog claims; any count identifies displayed jobs only.

### Requirement: Activity completeness

Activity MUST retain all matching loaded workers, narrow-screen cards with every field, Spanish case-insensitive search, all/active/inactive filters/reset, and active-first/name sorting.

Columns MUST remain: Trabajador, Estado, Inicio de jornada, Activo hasta, Producción semanal, Compañía, Trabajos entregados, Gasolina semanal, Ganancia, Acción.

#### Scenario: Filtered totals
- GIVEN nine loaded workers with distinct amounts
- WHEN filtering to two matches, then none
- THEN two rows retain all-nine TOTAL, including mobile; no-match/zero-worker states show no totals.

### Requirement: Existing interactions

The dashboard MUST preserve navigation, logout, permissions, notification loading/mark-read behavior, and five action destinations: `/trabajos/importar`, `/trabajos`, `/trabajos?status=en_revision`, `/equipos`, `/usuarios`.

#### Scenario: Worker details
- GIVEN a worker
- WHEN activating their name or `Detalles`
- THEN assigned-job modal/job links or separate production/fuel breakdown opens respectively; existing actions keep their destinations.

### Requirement: Feedback

Loading, empty, error, and retry behavior MUST remain intact.

#### Scenario: Unavailable content
- GIVEN pending/worker/modal emptiness or request failure
- WHEN loading or retrying
- THEN preserve existing feedback/recovery; failures MUST NOT masquerade as zero KPIs.

### Requirement: Responsive accessibility

The refresh MUST provide minimum 44×44 CSS-pixel targets, WCAG AA text contrast, keyboard operation, visible focus, non-color-only statuses, accessible names/table headers, filter/expanded states, and scoped Spanish language identification.

#### Scenario: Reflow
- GIVEN tablet, 390/320px, wider desktop, or 200% zoom with long names, addresses, amounts, dates, and breakdowns
- WHEN navigating content
- THEN full values remain readable/reachable without page overflow or hover-only disclosure; contain table scrolling only when necessary, never hiding columns.

#### Scenario: Focus
- GIVEN an administrator drawer or worker modal
- WHEN opened, tabbed, then dismissed with Escape
- THEN focus stays contained while open and returns to its trigger.
