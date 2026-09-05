## Exploration: admin-dashboard-visual-refresh

### Current State

**Planning only.** Recommend an administrator-only, opt-in presentation variant; preserve the existing data and interaction contracts. The user approved the visual proposal's appearance, not implementation or metric changes. The complete SDD plan must be presented in chat for confirmation before implementation.

- Session: `execution_mode:auto`; `artifact_store.mode:hybrid`; `delivery_strategy:auto-chain`; `review_budget_lines:800`; `chain_strategy:not_selected`.
- This phase permits only this exploration file and its equivalent Engram artifact. No runtime, tests/builds, source edits, database access, data mutations, commits, push, deployment, reviews, or child delegation were performed.
- Evidence: repository source inspected through CodeGraph first; files explicitly flagged stale were read directly where relevant. SQL evidence below is repository text, not inspection of a deployed database.

**Visual references inspected locally:**

- Approved target: `C:\Users\Bryan Jimenez\Desktop\Propuesta-dashboard-admin-2026-09-05.png` (1600×1100). Navy grouped sidebar, light topbar, compact weekly heading and four KPIs, pending-review grid above a full-width activity table, bottom quick-action bar. Its fictional data and proposal annotations are not product requirements.
- Authentic current dashboard: `C:\Users\Bryan Jimenez\Desktop\Dashboard-admin-actual-2026-09-05.png` (1905×2495). White sidebar; activity constrained beside stacked quick actions and pending reviews, causing column overflow and excessive vertical density. No personal identities, job identifiers, addresses, or operational amounts from this image are reproduced here. Neither image was uploaded externally.

**Architecture and contracts:**

- `app/dashboard/page.tsx:21–49` — `DashboardPage` calls `requireProfile`, parses the `week` query parameter, and branches technicians into `DashboardClient` plus `ShiftStartPrompt`. Both administrators and supervisors receive `AdminDashboard`; its name is not an administrator-only boundary. There is no dashboard-specific layout; `app/layout.tsx` supplies global fonts/CSS.
- `src/components/dashboard/admin-dashboard.tsx:108–134` — `AdminDashboard` currently composes `AppShell`, `PageHeader`, `StatCards`, and an `xl:grid-cols-3` layout: activity spans two columns; quick actions and pending review occupy the third. `AppShell` has 24 indexed callers across office pages; changing its defaults would redesign unrelated routes. `PageHeader`, filter chips, cards, and buttons also have shared consumers.
- `src/lib/jobs/queries.ts:190–212` — worker operations combine two RPC results, joining allocation cents by technician ID; invoiced totals use a separate RPC. `StatCards` counts server-provided `is_shift_active`, sums production/company/fuel amounts, and divides invoice cents by 100. Worker earnings use `weekly_allocated_cents / 100`, not a percentage inferred from the mockup. Active status must not be recalculated from browser time or shift timestamps; the operations RPC also considers shift companions.
- Week semantics are Friday 00:00 through the following Friday exclusive in `America/New_York`, displayed Friday→Thursday. Evidence: `supabase/migrations/20260905010000_shift_companions.sql:185–211`, `20260820002000_weekly_invoiced_total.sql:18–32`, and `src/lib/dashboard/format.ts:31–51`. Existing previous/next links change the offset by one; the current-week link appears when offset is nonzero. Preserve these links and server boundaries; the calendar ornament is not authorization for a date picker.
- `listOfficeJobs({ status: "en_revision" })` is independent of the selected week, excludes archived jobs, and orders by `updated_at` descending. Its source has no explicit query limit or exact total-count request. `PendingReview` displays `jobs.slice(0, 8)` and links to the complete pending-work route. Preserve the eight-item preview, ordering, loaded-result contracts, and navigation; do not assert that a loaded array length is the global backlog total. Service-side result limits were not inspected.
- `WorkerActivityTable:66–384` filters by Spanish case-insensitive name and shift status, sorting active workers first and names within each group. It renders all matching loaded rows without a six-worker cap. `TOTAL` aggregates all loaded rows, not filtered rows; the existing empty/no-match states replace the table. Desktop has ten columns and expandable details. Below `md`, existing cards retain row fields/interactions but currently omit the aggregate TOTAL.
- Worker-name activation calls `list_technician_assigned_jobs` and opens a modal with loading/error/empty states and job links. `Detalles` separately expands production and fuel breakdowns. Pending cards display photo count, review status, and all three PDF states (`pending`, `current`, `stale`); `Revisar` navigates to job detail, not a new inline approval action. `NotificationsBell` is a real existing feature with data loading and mark-read mutations, not a mockup ornament to replace.

**Reference-to-existing-function mapping:**

| Approved reference | Existing implementation and preservation boundary |
|---|---|
| Compact navy grouped navigation | `Sidebar` navigation array, role checks, active-state logic, logo, logout. Group the existing first six links as operations and three admin-only links as administration; keep all destinations and permissions. |
| Light topbar/profile and weekly heading | `Topbar`, existing `NotificationsBell`, profile-derived name/initials, `PageHeader`, and `AdminDashboard.weekControls`. No fabricated profile, notification count, breadcrumb workflow, or sample-data badge. |
| Four compact KPIs | `StatCards` → `StatCard`; retain current labels, data sources, units, and calculations. Sample worker counts and amounts are illustrative only. |
| Pending grid above activity | `PendingReview` with the same eight-item preview, metadata, PDF states, and `/trabajos?status=en_revision` / `/trabajos/${job.id}` links. |
| Full-width dense activity | `WorkerActivityTable`, `RowGroup`, `BreakdownPanel`, `showJobs`; retain search, all/active/inactive filters, reset, sorting, detail expansion, modal, and TOTAL. Columns: Trabajador, Estado, Inicio de jornada, Activo hasta, Producción semanal, Compañía, Trabajos entregados, Gasolina semanal, Ganancia, Acción. |
| Compact bottom quick-action bar | `QuickActions`: import → `/trabajos/importar`; all jobs → `/trabajos`; review → `/trabajos?status=en_revision`; teams → `/equipos`; users → `/usuarios`. Keep all five administrator actions. `/equipos` currently redirects to `/trabajos`; changing that behavior is out of scope. |

### Affected Areas

**Candidate implementation writes after plan approval, not changes made in this phase:**

- `src/components/dashboard/admin-dashboard.tsx` — administrator-only variant selection, section order, full-width composition, compact week navigation.
- `src/components/dashboard/{app-shell,sidebar,topbar}.tsx` — optional visual variant with unchanged defaults; compact navy navigation and light header only when explicitly opted in by administrator `/dashboard`.
- `src/components/dashboard/{stat-cards,pending-review,worker-activity-table,quick-actions}.tsx` — variant-specific density/layout and accessible interaction presentation; leave supervisor rendering and calculations unchanged.
- `src/components/ui/{page-header,stat-card,filter-toggle-chip}.tsx` and `src/components/dashboard/notifications-bell.tsx` — conditional candidates only where explicit styling/size hooks are needed. Preserve defaults and behavioral logic; prefer existing `className` hooks where available.
- A dashboard-local CSS module or locally applied utility classes — scoped tokens/selectors only. Any new fixture/check files belong to the later design/tasks plan, not this exploration.

**Read-only boundaries:**

- `app/dashboard/page.tsx`, `app/layout.tsx`, `app/globals.css`, `app/dashboard/{loading,error}.tsx` — preserve role routing, data loading, global styles, and shared loading/retry behavior. Loading/error components serve all dashboard roles and are not automatically safe to restyle.
- `src/lib/auth/session.ts`, `src/lib/jobs/{queries,types,delivered-status}.ts`, `src/lib/dashboard/format.ts`, Supabase migrations/RPCs, job review/detail pages, technician shells, and all other routes — no query, schema, permission, calculation, state-transition, or destination changes.
- `package.json`, `openspec/config.yaml`, main role/financial specs, `docs/00-PROYECTO.md`, `docs/01-ARQUITECTURA.md`, `docs/04-SEGURIDAD.md`, and `AGENTS.md` — planning context. Do not alter unrelated OpenSpec changes. Older overview docs describe historical MVP intentions; current source establishes present behavior.

### Approaches

1. **Explicit scoped variants on existing components** — opt in at `AdminDashboard` only for `profile.role === "admin"`; propagate a presentation variant to the shell and content components, keeping default output unchanged.
   - Pros: reuses navigation, permissions, calculations, and interactions; small rollback surface; avoids parallel dashboard logic.
   - Cons: shared files require carefully defaulted props and regression coverage for supervisors and other office pages; accessibility changes must also stay scoped.
   - Effort: Medium.

2. **Separate administrator presentation components** — keep the old dashboard/shell untouched and introduce an administrator-specific composition with reusable behavioral pieces.
   - Pros: stronger visual isolation and fewer conditional branches in legacy markup.
   - Cons: risks duplicating navigation, detail-modal behavior, and data-derived rendering; extracting those pieces increases scope and maintenance cost.
   - Effort: Medium–High.

### Recommendation

Choose **explicit scoped variants**, using local composition where a shared primitive cannot express the target cleanly. The variant is a presentation switch, never an authorization mechanism. Do not switch every administrator page, rely only on pathname detection, change global theme tokens, or add broad global CSS overrides. Keep the current server/client boundaries; the installed Next.js guides must be consulted before implementation APIs are changed.

**Layout and data decisions to carry into the proposal:**

1. Use the approved section order: heading/week navigator → four KPIs → full-width pending preview → full-width activity → five-action bottom bar. Preserve navy/blue branding and the existing logo. Allow content-driven page height rather than forcing the fictional screenshot's one-screen height.
2. Pending review uses a wrapping one/two/three-column grid at increasing available widths, rendering the same first eight loaded jobs. More than three produces additional rows, not clipping, a carousel, or a reduced limit. Retain the view-all link. Omit a purported total-backlog badge; if a preview count is shown, label it explicitly as the number displayed. No new count query.
3. Render every matching loaded worker. Keep a semantic ten-column table with a contained horizontal scroll region where necessary, rather than hiding financial/action columns or shrinking essential text. Retain compact mobile cards below the existing narrow breakpoint, including every row field, both detail interactions, and an administrator-only summary using the existing all-row TOTAL calculation whenever results are shown. Preserve existing empty/no-match behavior.
4. Keep numeric calculations, money precision, server-returned week bounds, current/previous/next links, and pending-review independence from week selection. Use selected-week wording outside offset zero; do not hard-code a current-week label, date range, new metric, or mockup value. Existing Spanish UI remains Spanish.

**Responsive and accessibility plan:**

- Desktop compactness comes from spacing and layout, not illegible fonts or inaccessible controls. Target at least 44×44 CSS-pixel interactive areas, readable 14px primary table text/16px mobile inputs, visible focus, non-color-only statuses, and verified text contrast. Existing global controls are 36/40/44px; override locally instead of changing global tokens.
- Stack heading/week controls and KPIs, wrap quick actions, and preserve all pending records on narrow screens. Keep overflow inside the table, not the page. Long names, addresses, amounts, dates, and breakdown lists must wrap or have an accessible full-value disclosure; do not rely solely on hover titles.
- Plan keyboard-operable week links, pressed-state filters, named table/scroll region, scoped table headers, and expanded-state details. The administrator drawer and worker modal need Escape dismissal, focus containment/return, and appropriate accessible names/dialog semantics without redesigning supervisor behavior. Scope Spanish language metadata to the refreshed surface because the root currently declares `lang="en"`.
- Preserve worker modal loading/error/empty states, pending empty state, zero-worker and no-filter-match states, plus route-level loading and retry behavior. Do not turn failed requests into fabricated zero KPIs. No global error-boundary redesign is needed.

**Testing capability and future checks — nothing executed now:**

- `package.json` confirms Next.js 16.3.0, React 19.2.8, TypeScript 5, Tailwind 4, and Supabase packages. Scripts are only dev/build/start/lint; no formal test script or configured unit/integration/e2e runner. `openspec/config.yaml` explicitly sets `strict_tdd:false` and `tdd:false`; Engram init #15 contains no strict-TDD requirement.
- Ad hoc Node assertion scripts exist, e.g. `scripts/verify-bulk-import-ui.mjs`; these are not dashboard visual coverage. `scripts/visual-bulk-fixture.mjs` creates/deletes real users using configured credentials, so it is unsuitable for a no-data-access visual check and was not run.
- After explicit implementation/runtime authorization, plan lint/build plus targeted offline contract checks, then a local synthetic-data rendering harness. Stub both server-provided dashboard data and browser RPC/auth/notification interactions; browser network interception alone does not isolate server reads. Deny real Supabase/Storage access, use no operational screenshot data or credentials, and define tooling in design before adding dependencies.
- Future viewport checks: 1600×1100 reference, wider desktop, intermediate tablet, 390px and 320px mobile, and 200% zoom. Fixtures should cover more than six workers; pending arrays of 0/1/3/8/>8; long strings and large amounts; every PDF/shift state; null timestamps; no results; loading/errors; week changes and Friday/Thursday/DST boundaries. Assert all-row TOTAL survives filtering, all ten columns remain reachable, five quick actions and job links remain intact, and keyboard/modal behavior works.
- Include negative-scope fixtures: supervisor `/dashboard`, technician `/dashboard`, and another administrator office page retain their default presentation and role-specific actions. Visual fixture checks do not prove deployed RPC/RLS behavior; no live-data verification is authorized here.

### Risks

- Shared shell/components make accidental portal-wide or supervisor restyling the main regression risk; use explicit opt-in variants and unchanged defaults.
- The real preview may occupy three grid rows and the worker list may be much longer than the sample. Exact screenshot height must yield to record preservation, readable text, and touch targets.
- A loaded preview count is not an authoritative backlog total. KPI and table totals have distinct inputs/units and must not be simplified to match example values.
- The empty-worker week fallback uses process-local `Date` arithmetic before New York formatting (`format.ts:3–14`), unlike server-returned boundaries. Treat this as a pre-existing timezone risk to cover/escalate, not permission to change week semantics in a visual refresh.
- Existing drawer/modal accessibility and mobile TOTAL gaps require explicitly scoped presentation work. Shared loading/error pages and global language/theme changes would expand scope.
- Live notification and assigned-job interactions can access or mutate data during future rendering checks. Isolation must be explicit; no configured-environment fixture helpers or private screenshot uploads.

### Ready for Proposal

**Yes.** There is enough evidence to propose the scoped visual refresh without database/schema/query changes. No blocking product decision remains under the conservative defaults above. Requests for a complete-backlog count, different preview limit, new metrics, changed week semantics, team-management behavior, or a portal-wide theme must be escalated rather than silently included.

Next: `sdd-propose` for this named change. Subsequent proposal/spec/design/tasks should assemble the complete plan for chat confirmation, then stop before implementation. Keep `review_budget_lines:800` and `chain_strategy:not_selected`; delivery slicing belongs to task planning and is not selected by this exploration.
