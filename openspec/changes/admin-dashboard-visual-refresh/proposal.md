# Proposal: Administrator Dashboard Visual Refresh

## Intent

Improve administrator scanning and table readability on `/dashboard` using approved `Propuesta-dashboard-admin-2026-09-05.png` styling, without fictional data or fixed height.

## Scope

### In Scope
- Compact navy sidebar, light header, four existing KPIs, full-width pending grid above the ten-column activity table, and bottom five-action bar.
- Preserve [exploration invariants](exploration.md): calculations, Friday→Thursday server week in `America/New_York`, week/navigation links, permissions, notifications, filters/sorting, both worker-detail interactions, photo counts, and all PDF states.
- Keep all matching loaded workers and all-loaded-row TOTAL despite filtering; add scoped mobile totals when results exist.
- Keep first-eight-loaded pending preview/destinations independent of selected week; no exact-backlog claims.
- Responsive keyboard/touch accessibility, contrast, and scoped drawer/modal focus handling.

### Out of Scope
- Other administrator routes, supervisor/technician presentation, global tokens, and shared route loading/error boundaries.
- Database/schema/query changes, invented metrics, date pickers, new routes, production sample rows, and pre-existing team-redirect/timezone-fallback fixes.

## Capabilities

### New Capabilities
- `admin-dashboard-presentation`: Administrator-only visual hierarchy, responsive accessibility, mobile totals, and existing-data/interaction preservation.

### Modified Capabilities
- None. `role-based-route-guard`, `financial-split-visibility`, `job-invoicing`, `job-lifecycle`, and `technician-route` requirements remain unchanged.

## Approach

Opt in from `AdminDashboard` only for administrators. Propagate optional presentation variants with unchanged defaults and local styles. Variants are not authorization. Preserve server/client boundaries and loading/error/empty states.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/components/dashboard/admin-dashboard.tsx` | Modified | Opt-in composition/order |
| `src/components/dashboard/{app-shell,sidebar,topbar}.tsx` | Modified | Scoped shell variant |
| `src/components/dashboard/{stat-cards,pending-review,worker-activity-table,quick-actions}.tsx` | Modified | Layout/accessibility |
| `src/components/ui/{page-header,stat-card,filter-toggle-chip}.tsx` | Conditional | Default-preserving styling hooks |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Shared-component leakage | Medium | Unchanged defaults; negative-scope checks |
| Real records exceed mockup height | High | Wrapping grid; uncapped rows; contained table scrolling |
| Misleading counts/totals | Medium | Preserve inputs; omit backlog claims |

## Rollback Plan

Remove administrator opt-in, restore prior composition, and revert refresh-only styling/hooks. No data repair required.

## Dependencies

- Follow `AGENTS.md` and `docs/{00-PROYECTO,01-ARQUITECTURA,04-SEGURIDAD}.md`.
- Present proposal/spec/design/tasks together in chat; final user confirmation precedes implementation. Future rendering checks must isolate server/browser data access.

## Success Criteria

- [ ] At 1600×1100, approved hierarchy/colors match; all required records, columns, actions, and invariants remain available.
- [ ] At 320/390px, tablet, wider desktop, and 200% zoom: no page overflow, keyboard-complete interactions, 44×44px targets, and WCAG AA text contrast.
- [ ] Supervisor/technician dashboards, another administrator route, permissions, and shared loading/error boundaries remain unchanged.
