# Portal Visual Redesign Specification

## Purpose

The portal SHALL provide a compact, responsive visual presentation for existing role workflows and routes, without changing operational behavior.

## Requirements

### Requirement: Compact responsive hierarchy

Existing board content MUST present a compact, scannable hierarchy of actions, status, and information on desktop and mobile. Essential information or interaction MUST NOT be introduced as image-only content.

#### Scenario: Desktop hierarchy

- GIVEN an authenticated user opens an approved board on a desktop viewport
- WHEN the board renders
- THEN its existing primary actions, status, and workflow information are visibly prioritized without horizontal clipping

#### Scenario: Mobile hierarchy

- GIVEN an authenticated user opens the same board on a mobile viewport
- WHEN the viewport is narrow
- THEN the hierarchy remains compact, readable, and usable without horizontal clipping or image-only controls

### Requirement: Role-filtered navigation continuity

Navigation MUST preserve each current role's existing visible destinations, active-route indication, logout behavior, and access boundaries. Navigation SHALL remain non-authoritative; server-side profile, role, and active-shift checks MUST continue to determine access.

#### Scenario: Permitted navigation

- GIVEN a user with an existing permitted role and session
- WHEN the user views desktop or mobile navigation
- THEN the user sees and can follow only their existing role-filtered destinations

#### Scenario: Disallowed destination

- GIVEN a user lacks access to an existing protected destination
- WHEN the user attempts to reach that destination directly
- THEN server authorization denies access as it did before the redesign

### Requirement: Accessible presentation and retained states

Interactive controls MUST expose visible keyboard focus, usable touch presentation, and safe-area-aware mobile positioning. Existing loading, empty, error, and workflow states SHALL remain available with their prior meaning and actions.

#### Scenario: Keyboard and safe-area use

- GIVEN an approved board is rendered on desktop or a safe-area-constrained mobile device
- WHEN the user navigates controls by keyboard or touch
- THEN focus is visible and actionable controls remain reachable and unobscured

#### Scenario: Retained empty or error state

- GIVEN an approved board has an existing empty or error condition
- WHEN the condition is rendered after the redesign
- THEN its existing message, recovery action, and workflow meaning remain available

### Requirement: Visual-only behavior preservation

The redesign MUST NOT change routes, URL destinations, server authorization, permissions, RLS, server actions, data flows, state rules, or workflow outcomes. PDF editor delivery and validation MUST remain unchanged. The change MUST NOT introduce a universal-shell rewrite, new modules, or modifications to unrelated dirty `technician-route` work.

#### Scenario: Protected workflow regression

- GIVEN an existing authorized workflow and its corresponding unauthorized case
- WHEN each is exercised after the redesign
- THEN its data result, permission result, and state transition match the pre-redesign behavior

#### Scenario: PDF delivery validation

- GIVEN a job delivery requiring the existing PDF editor validation
- WHEN the user submits valid or invalid delivery data
- THEN delivery acceptance and validation outcomes match the pre-redesign behavior

### Requirement: Six-board desktop and mobile approval

Every cell in the following final approval matrix MUST satisfy the preceding requirements before release.

| Role | Board | Desktop | Mobile |
|---|---|---|---|
| Admin | Dashboard | MUST pass | MUST pass |
| Admin | Administration | MUST pass | MUST pass |
| Supervisor | Office Jobs | MUST pass | MUST pass |
| Supervisor | Review | MUST pass | MUST pass |
| Technician | Field | MUST pass | MUST pass |
| Technician | Fleet | MUST pass | MUST pass |

#### Scenario: Admin approval

- GIVEN an Admin session on Dashboard and Administration
- WHEN each board is reviewed on desktop and mobile
- THEN every corresponding matrix cell passes

#### Scenario: Supervisor approval

- GIVEN a Supervisor session on Office Jobs and Review
- WHEN each board is reviewed on desktop and mobile
- THEN every corresponding matrix cell passes

#### Scenario: Technician approval

- GIVEN a Technician session on Field and Fleet
- WHEN each board is reviewed on desktop and mobile
- THEN every corresponding matrix cell passes
