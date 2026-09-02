# Design: Portal-wide Compact Responsive Redesign

## Technical Approach

Apply the approved compact hierarchy through existing presentation boundaries only. Extend Tailwind v4 tokens and existing primitives, then migrate office/administration before field/fleet. This implements `portal-visual-redesign` without changing routes, server data, or workflow behavior.

## Architecture Decisions

| Option | Trade-off | Decision |
|---|---|---|
| One universal role shell | Crosses established role, session, and mobile boundaries | Retain and visually refine `AppShell`, `FieldShell`, and `TechnicianAppShell`. |
| New shared navigation module | Violates the no-new-modules requirement | Retain local navigation declarations and active-match helpers in existing navigation components; refine presentation only. |
| Per-page styling | Duplicates compact rules | Extend existing theme tokens and UI primitives while preserving their props, labels, states, and semantics. |
| Authorization in navigation | Makes links an access boundary | Preserve server profile/role/active-shift guards, RLS, queries, actions, and state transitions. |

Existing interactive components remain the client boundary; pages retain the current Server Component data flow and serializable props.

## Data Flow

```text
Server page -> existing profile/role/shift guards -> existing queries
     |                                              |
     +-> existing props -> shell + local navigation -> current Link destinations
                              |
                       tokens and UI primitives -> existing page children
```

No presentation component imports server actions or Supabase server clients. PDF delivery and validation remain outside this change.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/globals.css` | Modify | Add compact density, spacing, radius, shadow, control, focus, and safe-area tokens without redefining existing meanings. |
| `src/components/ui/button.tsx` | Modify | Consume presentation tokens without changing public props or behavior. |
| `src/components/ui/card.tsx` | Modify | Consume presentation tokens without changing public props or behavior. |
| `src/components/ui/page-header.tsx` | Modify | Refine compact hierarchy without changing its interface. |
| `src/components/ui/empty-state.tsx` | Modify | Retain existing messages and recovery context. |
| `src/components/ui/status-badge.tsx` | Modify | Retain status mapping, labels, and semantics. |
| `src/components/dashboard/app-shell.tsx` | Modify | Refine office shell and mobile drawer presentation only. |
| `src/components/dashboard/sidebar.tsx` | Modify | Retain local role filtering, hrefs, active matching, and logout behavior. |
| `src/components/dashboard/topbar.tsx` | Modify | Refine responsive account and notification presentation. |
| `src/components/dashboard/field-shell.tsx` | Modify | Refine existing field presentation without changing destinations. |
| `src/components/dashboard/admin-dashboard.tsx` | Modify | Migrate Dashboard and Administration presentation first. |
| `src/components/dashboard/stat-cards.tsx` | Modify | Refine existing metrics presentation only. |
| `src/components/dashboard/worker-activity-table.tsx` | Modify | Preserve queries, filters, dialogs, and responsive representations. |
| `src/components/dashboard/pending-review.tsx` | Modify | Preserve review links, status, and empty state. |
| `app/trabajos/page.tsx` | Modify | Refine Office Jobs and Review composition without changing data or actions. |
| `src/components/dashboard-client.tsx` | Modify | Refine existing dashboard presentation without changing role-derived destinations. |
| `src/components/fleet/technician-fleet-workspace.tsx` | Modify | Refine Fleet presentation without changing fleet actions or forms. |
| `app/camiones/mi-camion/page.tsx` | Modify | Refine Fleet page composition only. |
| `src/components/dashboard/technician-app-shell.tsx` | Modify last | After `technician-route` is integrated, apply a separate visual-only patch retaining local items, `#evidencias`, active matching, and logout cleanup. |
| `src/components/dashboard/mobile-bottom-nav.tsx` | Modify last | After `technician-route` is integrated, refine safe-area presentation while retaining existing destinations. |
| `src/components/jobs/pdf-code-editor.tsx` | Preserve | Use as visual reference only; do not change delivery behavior. |
| `app/trabajos/[id]/entregar/page.tsx` | Preserve | Do not change delivery, validation, or workflow outcomes. |
| `src/lib/auth/session.ts` | Preserve | Do not change server authorization. |
| `src/lib/work-shifts/access.ts` | Preserve | Do not change active-shift access behavior. |

## Interfaces / Contracts

No new module or exported contract is introduced. `Sidebar`, `TechnicianAppShell`, and `MobileBottomNav` retain their existing local navigation declarations and pathname matching. Current role props, hrefs, labels, ordering, and direct-URL server protection remain unchanged.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Automated quality | Type and lint | Run `npm run lint` and `npm run build`; no test runner or visual/E2E suite exists. |
| Manual visual regression | Twelve approval cells | At 1440x900 and 390x844, review Admin Dashboard/Administration, Supervisor Office Jobs/Review, and Technician Field/Fleet for hierarchy, clipping, content, retained states, focus, touch targets, and safe-area navigation. |
| Functional smoke | Behavior preservation | Per role, compare visible destinations, active indication, logout, an allowed workflow, and a direct disallowed URL. Confirm active-shift and valid/invalid PDF delivery outcomes match baseline. |

## Threat Matrix

N/A — no route definitions, redirects, href destinations, shell commands, subprocesses, VCS/PR automation, executable-file classification, or process-integration boundary changes.

## Migration / Rollout

No migration or feature flag is required. Preserve dirty `technician-route` work; complete office/administration first and only apply technician navigation styling after integration. Release one visual bundle after all twelve approval cells and functional smokes pass.

## Open Questions

None.
