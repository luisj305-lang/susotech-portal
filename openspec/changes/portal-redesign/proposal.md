# Proposal: Portal-wide Compact Responsive Redesign

## Intent

Unify the portal's compact, responsive presentation around the approved PDF-editor hierarchy and six boards, making role workflows easier to scan without changing operational behavior.

## Scope

### In Scope
- Add presentation tokens for density, spacing, radius, color, shadow, compact controls, and status display.
- Refine existing office and field shells plus navigation rendering; migrate office/administration before technician/fleet workflows.
- Perform accessible desktop/mobile visual comparison against every approved board.

### Out of Scope
- Routes, data flows, server actions, authorization, RLS, permissions, state rules, and workflow behavior.
- PDF-editor delivery/validation changes, image-only or new modules, a universal-shell rewrite, and unrelated dirty `technician-route` work.

## Capabilities

### New Capabilities
- `portal-visual-redesign`: Responsive visual-presentation acceptance for existing portal roles and routes.

### Modified Capabilities
None. Existing OpenSpec requirements remain behavior-preservation constraints.

## Approach

Apply foundations through `AppShell`, `TechnicianAppShell`, and `FieldShell`; share presentation primitives and navigation-rendering contracts only. Navigation remains non-authoritative: existing server profile, role, and active-shift checks remain intact. Sequence foundations, office navigation, office/administration, technician/fleet, then accessibility, regression, and final approval.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `app/globals.css`, `src/components/ui/*` | Modified | Compact visual tokens and primitives. |
| `src/components/dashboard/*shell*.tsx`, `sidebar.tsx`, `topbar.tsx`, `mobile-bottom-nav.tsx` | Modified | Presentation-only shell and navigation refinement. |
| `app/dashboard/page.tsx`, `src/components/dashboard-client.tsx`, `admin-dashboard.tsx`, `app/trabajos/page.tsx`, `app/camiones/**` | Modified | Role workflow surfaces only. |
| `src/components/jobs/pdf-code-editor.tsx`, `app/trabajos/[id]/entregar/page.tsx` | Protected | Visual reference only; no delivery changes. |

## Final Approval Matrix

Each cell requires compact hierarchy, correct role-filtered navigation, keyboard focus, safe-area/touch behavior, empty/error states, and no image-only content.

| Role | Approved boards | Desktop | Mobile |
|---|---|---|---|
| Admin | Dashboard, Administration (1, 6) | [ ] | [ ] |
| Supervisor | Office Jobs, Review (2, 3) | [ ] | [ ] |
| Technician | Field, Fleet (4, 5) | [ ] | [ ] |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Navigation styling changes visible actions | Medium | Review matrix; retain server guards and action checks. |
| Shell variation and no visual suite hide regressions | High | Compare all six boards on both form factors before one bundled release. |

## Rollback Plan

Revert the visual bundle together to the prior tokens, primitives, and shell styling. No data or migration rollback is required; never deploy a partial module redesign.

## Dependencies

- Approved six boards and PDF editor as visual-only reference.
- `docs/00-PROYECTO.md`, `docs/01-ARQUITECTURA.md`, `docs/04-SEGURIDAD.md`, and `AGENTS.md` instructions.

## Success Criteria

- [ ] All six matrix boards pass on desktop and mobile with visual-only changes; routes, server authorization, permissions, data flows, and PDF delivery remain unchanged.
- [ ] The complete verified redesign releases together after accessibility and functional regression checks, never by module.
