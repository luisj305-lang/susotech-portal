# Tasks: Auth Foundation Hardening

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450–650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (foundation) → PR 2 (pages + user management) → PR 3 (RLS + verify) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Test command | Runtime harness | Rollback boundary |
|------|------|----|--------------|-----------------|-------------------|
| 1 | Env, clients, proxy, session guards | PR 1 | `npm run lint && npm run build` | Manual: `/dashboard` without session → `/login` | Revert `proxy.ts`, `src/lib/supabase/*`, `src/lib/auth/session.ts`, `.env.local` |
| 2 | Login, reset-password, page states | PR 2 | `npm run lint && npm run build` | Manual: login → dashboard, recovery → `/reset-password` | Revert changed files in `app/` |
| 3 | RLS migration, verification, cleanup | PR 3 | `npm run lint && npm run build` | Manual: role/inactivity access + direct API calls | Revert migration file and Supabase migration |

## Phase 1: Environment & Edge Foundation

- [x] 1.1 Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local`; keep old key temporarily.
- [x] 1.2 Update `src/lib/supabase/client.ts` to use `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [x] 1.3 Update `src/lib/supabase/server.ts` to use `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [x] 1.4 Move current `src/lib/supabase/proxy.ts` logic into `src/lib/supabase/update-session.ts`.
- [x] 1.5 Create root `proxy.ts` calling `updateSession` and protecting private routes.
- [x] 1.6 Delete old `src/lib/supabase/proxy.ts`.
- [x] 1.7 Run `npm run lint` and `npm run build`.

## Phase 2: Session Guards

- [x] 2.1 Add `requireRole(role: UserRole)` to `src/lib/auth/session.ts`; reject inactive accounts and wrong roles.
- [x] 2.2 Keep `requireAdmin()` as alias for `requireRole('admin')`.
- [x] 2.3 Ensure `requireProfile()` rejects inactive accounts.
- [x] 2.4 Manually verify redirects to `/acceso-denegado` for inactive/wrong-role users.

## Phase 3: Pages & UI

- [x] 3.1 Update `app/layout.tsx` metadata to "Susotech Portal".
- [ ] 3.2 Rewrite `app/page.tsx` to remove `projects` query and keep public landing. *(omitido por decisión del usuario: landing externa, `app/page.tsx` no se modifica)*
- [x] 3.3 Add loading/error/recovery states to `app/login/page.tsx`; redirect to `/dashboard` on login.
- [x] 3.4 Create `app/reset-password/page.tsx` as Client Component; use hash session and `updateUser({ password })` via a dedicated `createClient` with `flowType: 'implicit'`. `createBrowserClient` forces PKCE and rejects the implicit-grant recovery hash.
- [x] 3.5 Add loading/error states to `app/dashboard/page.tsx`.
- [x] 3.6 Add loading/error states to `app/usuarios/page.tsx`.
- [x] 3.7 Run `npm run lint` and `npm run build`.
- [x] 3.8 Create `src/lib/supabase/service.ts` using `SUPABASE_SERVICE_ROLE_KEY` (server-only).
- [x] 3.9 Create server actions in `src/lib/users/actions.ts` for create, update profile, and role/status changes.
- [x] 3.10 Update `src/components/users-manager.tsx` with create/edit modal, validation, and self-protection.
- [x] 3.11 Add delete user action and confirmation dialog in `/usuarios`.
- [x] 3.12 Verify service role key is not exposed in client code.

## Phase 4: Database Security

- [x] 4.1 Create migration `supabase/migrations/20260809_harden_profile_rls.sql` with own-row read, admin write, active-only policies.
- [x] 4.2 Apply migration in Supabase.
- [x] 4.3 Manually test RLS per role and inactive accounts.

## Phase 5: Verification & Rollout

- [x] 5.1 Run full manual E2E: login → dashboard → logout → denied → recovery → reset → login.
- [x] 5.2 Test each role (`admin`, `supervisor`, `tecnico`) and one inactive account.
- [x] 5.3 Run `npm run lint` and `npm run build` on complete change.
- [x] 5.4 Fix `/reset-password` recovery flow: verify `createBrowserClient` hardcodes `flowType: 'pkce'`, switch reset page to `createClient` with `flowType: 'implicit'`, run `npm run lint` and `npm run build`.
- [ ] 5.5 Remove old `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from `.env.local`.
