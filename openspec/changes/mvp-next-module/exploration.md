# Exploration: MVP next module

### Current State

The project has a working but incomplete authentication and user-management layer on top of an otherwise empty MVP shell.

**What exists:**
- Next.js 16 App Router with `login`, `dashboard`, `usuarios`, and `acceso-denegado` pages.
- Supabase Auth integration via `@supabase/ssr` for both browser and server.
- `profiles` table with roles (`admin`, `supervisor`, `tecnico`), `full_name`, and `is_active`.
- Server-side session helpers `requireProfile` and `requireAdmin` in `src/lib/auth/session.ts`.
- A `proxy.ts` helper for cookie/session refresh in middleware-like flows.
- Basic user administration page (`/usuarios`) that lets an admin change roles and activation status.

**What is missing or inconsistent:**
- No `middleware.ts` is visible; it is unclear whether `proxy.ts/updateSession` is actually wired to route protection.
- The home page (`app/page.tsx`) queries a `projects` table that does not exist in migrations; the domain vocabulary uses "jobs", not "projects".
- Environment variable mismatch: code references `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` while docs and common Supabase setups use `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Root layout metadata still says "Create Next App".
- The dashboard "+ Nuevo Proyecto" button is non-functional.
- No password recovery, no session-expiration handling, and no role-based guards beyond admin/non-admin.
- No test runner; verification relies entirely on lint and build.

### Affected Areas

- `app/layout.tsx` — default metadata must be updated to Susotech Portal.
- `app/page.tsx` — placeholder query against `projects` should be removed or replaced with a real landing/dashboard redirect.
- `app/login/page.tsx` — needs password-recovery link and better error/loading states.
- `src/lib/auth/session.ts` — needs `requireRole(...)` helper for `supervisor` and `tecnico`, and explicit inactive-account handling.
- `src/lib/supabase/client.ts` — environment variable name should align with project docs.
- `src/lib/supabase/proxy.ts` — needs to be consumed by `middleware.ts` for global route protection.
- `app/dashboard/page.tsx` and `app/usuarios/page.tsx` — need role-specific loading and error boundaries.
- `supabase/migrations/` — needs RLS hardening for profile self-read and admin updates, plus migration for `password_reset` audit if required.

### Approaches

1. **Auth Foundation Hardening** — Complete the authentication layer before building business features.
   - Pros:
     - Closes known security and consistency gaps.
     - Aligns with docs/05-MVP increment 1 ("Acceso") and PROJECT_PLAN Fase 1.
     - Small, completable scope; unblocks safer work on jobs, files, and review.
     - Reduces rework later because every future page will rely on these guards.
   - Cons:
     - Does not deliver visible user value in the first demo.
     - Requires decisions on role matrix and environment variables.
   - Effort: Low-Medium

2. **Jobs & Assignments Module** — Jump directly to the core `jobs` entity and assignment flow.
   - Pros:
     - Delivers the main MVP value proposition early.
     - Follows docs/05-MVP increment 2 ("Trabajos y asignaciones").
     - Provides concrete screens for stakeholder feedback.
   - Cons:
     - Builds on an unfinished auth foundation (middleware wiring, role matrix, env var naming).
     - Will likely force a partial auth refactor mid-module.
     - Higher risk of security gaps in the first iteration.
   - Effort: Medium-High

3. **Hybrid: Auth hardening + minimal jobs scaffold** — Fix auth gaps and create a read-only `jobs` table/list in one increment.
   - Pros:
     - Balances foundation work with a visible milestone.
     - Lets the team validate the jobs data model quickly.
   - Cons:
     - Larger than a single focused module; risks scope creep.
     - Still defers full assignment and state-transition logic.
   - Effort: Medium

### Recommendation

Choose **Approach 1: Auth Foundation Hardening** as the next module.

Reasoning: the current codebase has clear, well-bounded gaps in route protection, role enforcement, environment variable naming, and project vocabulary. Closing these first is cheaper than retrofitting them while also designing the jobs schema and workflows. The documented roadmap (docs/05-MVP and PROJECT_PLAN Fase 1) also treats access and roles as the first increment. Once this module is verified, the team can move to the Jobs & Assignments module with confidence that pages, actions, and RLS policies have a consistent authorization base.

### Risks

- **Naming drift:** the `projects` reference in `app/page.tsx` must be resolved to `jobs` before the jobs module starts.
- **Environment variable mismatch:** if `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is intentionally required by the installed `@supabase/ssr` version, switching to `ANON_KEY` could break the build. Verify against the installed package before changing.
- **No test runner:** all verification will be manual (`lint`, `build`, browser checks), increasing the chance of missing edge cases in RLS or redirects.
- **Next.js 16 API drift:** any middleware or server-action pattern must be checked against `node_modules/next/dist/docs/` per `AGENTS.md`.

### Ready for Proposal

Yes. Proceed to `/sdd-propose` with change name `auth-foundation-hardening` to define scope, acceptance criteria, and rollback plan.
