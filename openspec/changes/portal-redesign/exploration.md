## Exploration: Portal redesign foundations: shell, tokens, and navigation

### Current State
The authenticated portal is split across four presentation paths: office pages use `AppShell` with `Sidebar` and `Topbar`; technician workflows use `TechnicianAppShell` with a desktop rail and mobile bottom navigation; the technician job list uses the smaller `FieldShell`; and the technician dashboard still renders `DashboardClient` with inline styles. `app/trabajos/page.tsx` selects its field or office shell only after `requireProfile()` and retains the technician active-shift guard. Authorization remains in server guards such as `requireAdmin`, `requireSupervisor`, and action-level checks; navigation visibility is not an authorization boundary.

`app/globals.css` centralizes brand, ink, surface, and shadow tokens, but not shared density, spacing, radius, or component contracts. `Button` is broadly reused, while status badges, cards, and form fields still mix inline styles and repeated Tailwind strings. The PDF editor is an appropriate compact visual reference, but its delivery and validation flow is behaviorally coupled and must remain untouched by the redesign.

### Affected Areas
- `app/globals.css` — extend the visual token and base-control contract without changing global semantics unexpectedly.
- `src/components/ui/button.tsx`, `src/components/ui/status-badge.tsx` — stabilize shared compact action and status presentation before page-level migration.
- `src/components/dashboard/app-shell.tsx`, `sidebar.tsx`, `topbar.tsx` — office shell, responsive drawer, role-filtered navigation, and shared header used by 27 `AppShell` callers.
- `src/components/dashboard/technician-app-shell.tsx`, `mobile-bottom-nav.tsx`, `field-shell.tsx` — reconcile field presentation and responsive navigation while preserving their existing routes and logout behavior.
- `app/dashboard/page.tsx`, `src/components/dashboard-client.tsx`, `src/components/dashboard/admin-dashboard.tsx` — align the dashboard variants, including the technician dashboard's inline-styled surface, without changing data loading or shift prompts.
- `app/trabajos/page.tsx`, `src/lib/auth/session.ts` — retain server profile selection, active-shift enforcement, role guards, and existing office/technician route behavior.
- `src/components/jobs/pdf-code-editor.tsx`, `app/trabajos/[id]/entregar/page.tsx` — use only as the approved visual reference; preserve the editor's delivery behavior and validation contract.

### Approaches
1. **Presentation foundations applied through existing shells** — define compact visual tokens and reusable presentation primitives, then refine each existing shell and migrate pages in priority order.
   - Pros: preserves routes, server authorization, data contracts, and role-specific workflow boundaries; limits behavioral regression risk; matches the approved foundations-first scope.
   - Cons: existing shell variants remain while their duplicated navigation is carefully consolidated at the presentation level.
   - Effort: Medium

2. **Replace the shell layer with one universal role-configured shell** — move all authenticated layouts and navigation into a new role-driven container before restyling pages.
   - Pros: reduces long-term shell duplication.
   - Cons: couples a visual redesign to navigation and session behavior, expands the blast radius across all roles, and risks changing field workflows or creating image-only concepts.
   - Effort: High

### Recommendation
Use Approach 1. Keep `AppShell`, `TechnicianAppShell`, and `FieldShell` as behavior-preserving boundaries; share only presentational tokens, primitives, and navigation rendering contracts where the existing routes already match. Sequence the proposal as: (1) desktop/mobile visual acceptance baseline from all six approved boards; (2) tokens and shared primitives; (3) office shell and navigation; (4) office and administration workflows; (5) technician field workflows and fleet; (6) accessibility, regression, and final visual approval. Do not infer new pages or permissions from the boards.

### Risks
- Moving role or active-shift policy into hidden navigation would weaken existing server-side authorization; guards and action checks must remain unchanged.
- Technician navigation currently contains the unrelated dirty `mi-ruta` work and an existing `#evidencias` anchor; the redesign must preserve that work and must not invent a route or module for the anchor.
- There is no configured automated test runner, visual regression suite, or E2E matrix. Verification must explicitly cover admin, supervisor, and technician desktop/mobile navigation, authenticated workflow smoke checks, focus and safe-area behavior, and side-by-side desktop and mobile comparison with all six approved boards before deployment.

### Ready for Proposal
Yes. The proposal should define visual-only acceptance criteria, the six-board desktop/mobile review matrix, and the foundations-first sequence above, while explicitly prohibiting changes to routes, server authorization, permissions, data flows, and unrelated `technician-route` work. No delivery-size forecast or implementation plan was produced in this exploration.
