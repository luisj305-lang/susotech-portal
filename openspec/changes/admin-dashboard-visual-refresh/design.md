# Design: Administrator Dashboard Visual Refresh

## Technical Approach

Implement only `admin-dashboard-presentation`: [proposal](proposal.md), [8 requirements/10 scenarios](specs/admin-dashboard-presentation/spec.md), [invariants](exploration.md) unchanged.

At 1600×1100: approximately 216px navy sidebar, 72px light header, 28px gutters, 20px gaps, 12px corners. Order: heading/week → four KPIs (120px minimum, icons right) → full-width pending grid → ten-column activity → five-action bar. Content-driven height; real logo/profile; existing navigation grouped; no fictional badges/records.

## Architecture Decisions

| Option | Tradeoff | Decision/rationale |
|---|---|---|
| Explicit variant / pathname theme | Prop plumbing | Explicit: supervisor shares `AdminDashboard`; 24 `AppShell` callers. |
| Reuse / duplicate | Scoped branches | Reuse behavior; unchanged defaults. |
| CSS module / globals | Local hooks | Module prevents theme propagation. |
| Existing tools / runner | Harness maintenance | Node assertions, installed Next, Chromium/CDP; no dependencies. |

## Data Flow

`DashboardPage → requireProfile/parallel queries → AdminDashboard → AppShell(children)/sections`

Preserve [server composition/serializable props](../../../node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md); `AppShell` imports `Topbar` into its client graph. Auth/RLS/state transitions/queries/calculations remain unchanged.

## File Changes

**Future implementation only:**

| Paths | Action | Purpose |
|---|---|---|
| `src/components/dashboard/{admin-dashboard,app-shell,sidebar,topbar}.tsx` | Modify | Composition/shell |
| `src/components/dashboard/{stat-cards,pending-review,worker-activity-table,quick-actions,notifications-bell}.tsx` | Modify | Layout/accessibility |
| `src/components/dashboard/admin-dashboard.module.css` | NEW | Scoped styles |
| `src/components/dashboard/admin-dashboard-{presentation.ts,dialog.tsx}` | NEW | Variant type/client dialog |
| `src/components/ui/{page-header,stat-card,filter-toggle-chip}.tsx` | Conditional | Default-preserving hooks if existing props/wrappers cannot suffice |
| `scripts/verify-admin-dashboard{,-contracts}.mjs` | NEW | Browser/offline assertions |
| `scripts/lib/dashboard-harness.mjs` | NEW | Reusable fixture/CDP lifecycle |
| `scripts/fixtures/{admin-dashboard,dashboard-boundaries}.ts` | NEW | Synthetic cases/mocks |

No deletions; shared loading/error, other routes, globals/services/schema untouched.

## Interfaces / Contracts

`presentation?: "default" | "admin-dashboard"` defaults legacy; only `AdminDashboard` with `profile.role === "admin"` opts in, never pathname-only or authorization. Optional `weekOffset` adjusts refreshed KPI/activity wording.

Preserve invoice/earnings cents÷100, units/precision, server active flags/Friday→Thursday New York weeks/week links. Pending: first eight loaded, updated-descending, week-independent, metadata/PDF states/destinations, no backlog claim. Workers: all matching rows, Spanish search/status/reset/sorting, all-row TOTAL only with results, five links. Names open assigned-job RPC/modal; `Detalles` expands separate breakdowns.

KPI 1/2/4 and pending 1/2/3 columns; below `md`, cards retain every field plus TOTAL. Scoped `min-width:0`, wrapping, named table scroller/headers, pressed/expanded states, `lang="es"`, visible focus, AA contrast, ≥14px text/16px inputs/44px controls. Admin-only native dialogs provide initial focus, containment/inertness, Escape/cancel, trigger restoration; legacy overlays unchanged.

## Testing Strategy

Future harness copies allowlisted actual dashboard/default-route source into a temporary Next app. Fixture-only Webpack aliases replace server auth/queries/shift/fleet and browser Supabase before imports; reject real SDK imports. No `.env`, credentials, DB fixtures, external requests. Real notifications/logout/worker handlers record fake responses. Offline contracts execute real query/format modules against fake clients through an allowlisted TypeScript-transpiling loader. Render actual server/client composition; baseline default views. Use local fonts; report fidelity gaps. Temporary PDF harness is not a dependency.

Generate fixture config only; launch installed Next CLI with `--webpack` under the approved temporary parent, never the configured application. Include actual `app/dashboard/page.tsx`, loading/error boundaries and `app/trabajos/importar/page.tsx` with isolated dependencies. Assert source hashes unchanged; missing browser/tooling fails explicitly, never installs automatically.

| Requirement → scenario(s) | Planned evidence |
|---|---|
| Scope → Isolation; Approval gate | Three roles/another admin route; confirmation record |
| Hierarchy → Reference | Screenshots/geometry, uncapped content |
| Values and weeks → Week navigation | Money, Friday/Thursday/DST, links/wording |
| Pending preview → Preview sizes | 0/1/3/8/9, all PDF states |
| Activity completeness → Filtered totals | Nine→two→none, desktop/mobile |
| Existing interactions → Worker details | Both paths, five links, notifications/logout |
| Feedback → Unavailable content | Delays/errors/empties/retry, never zero-KPI errors |
| Responsive accessibility → Reflow; Focus | 320/390/tablet/1600/wider, 200% zoom, keyboard/contrast |

## Threat Matrix

Propagate applicable rows unchanged into tasks/RED tests; otherwise `strict_tdd:false`.

| Boundary | Applicability/reason | Safe/failure behavior; RED tests |
|---|---|---|
| Documentation-like paths | N/A: no classification | — |
| Git repository selection | N/A: no Git invocation | — |
| Commit state | N/A: no commits | — |
| Push state | N/A: no pushes | — |
| PR commands | N/A: no PRs | — |
| Harness subprocess/network | Applicable | Trusted executables, argv/no shell, loopback, isolated temp/profile, allowlisted environment; reject escaped paths/unexpected server/browser traffic; timeouts/finally clean only owned processes/temp. RED: spaced/metacharacter paths, output escape, missing executable, unexpected traffic, startup/child failure. |

## Migration / Rollout

No migration required. Tasks then combined chat confirmation before apply. Authorized lint/build/offline checks precede separately approved deployment. Rollback removes opt-in, restores legacy composition/styles; no data repair. Chain strategy/topology unselected.

## Open Questions

None blocking; implementation confirmation required.
