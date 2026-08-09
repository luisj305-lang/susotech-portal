# Proposal: Endurecimiento de la base de autenticación y autorización

## Intent
Completar la base de autenticación y autorización de Susotech Portal antes del módulo de trabajos, cerrando brechas detectadas en `sdd/mvp-next-module/explore`.

## Scope

### In Scope
- `middleware.ts` con `src/lib/supabase/proxy.ts`.
- Renombrar variable `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` a `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `requireRole(role)` en `src/lib/auth/session.ts` con cuentas inactivas.
- Metadata raíz en `app/layout.tsx`.
- Reemplazar consulta `projects` en `app/page.tsx`.
- Mejorar login: recuperación de contraseña, estados.
- Endurecer RLS de `profiles`.

### Out of Scope
- Trabajos, asignaciones, archivos o revisiones.
- Nuevas tablas de negocio.
- Pruebas automatizadas.

## Capabilities

### New Capabilities
- `global-auth-middleware`: Protección y refresco de sesión en middleware.
- `role-based-route-guard`: Verificación de roles `admin`, `supervisor`, `tecnico`.
- `password-recovery-flow`: Recuperación de contraseña en login.
- `profile-rls-hardening`: Políticas RLS reforzadas para `profiles`.

### Modified Capabilities
- Ninguno.

## Approach
Crear `middleware.ts` con `updateSession` protegiendo rutas privadas. Extender `session.ts` con `requireRole(role)` rechazando inactivos. Sincronizar variable de entorno en `client.ts`, `server.ts` y `proxy.ts`. Actualizar metadata, eliminar consulta a `projects` y redirigir a `/dashboard` con sesión. Agregar recuperación de contraseña y estados en login. Crear migración RLS para `profiles`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `middleware.ts` | New | Middleware protección y refresco. |
| `src/lib/supabase/proxy.ts` | Modified | Consumido por middleware. |
| `src/lib/supabase/client.ts` | Modified | Variable de entorno. |
| `src/lib/supabase/server.ts` | Modified | Variable de entorno. |
| `src/lib/auth/session.ts` | Modified | `requireRole(role)` y cuentas inactivas. |
| `app/layout.tsx` | Modified | Metadata Susotech Portal. |
| `app/page.tsx` | Modified | Eliminar `projects`; redirigir. |
| `app/login/page.tsx` | Modified | Recuperación contraseña y estados. |
| `app/dashboard/page.tsx`, `app/usuarios/page.tsx` | Modified | Estados carga/error. |
| `supabase/migrations/` | New | Migración RLS para `profiles`. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `ANON_KEY` incompatible con `@supabase/ssr`. | Med | Verificar API antes de cambiar. |
| RLS bloquea acceso legítimo. | Med | Probar con cada rol. |
| Regresiones en redirecciones. | Low | Validar build y navegador. |
| Sin runner de pruebas. | High | Verificar lint/build y escenarios manuales. |

## Rollback Plan
1. Revertir archivos con `git checkout`.
2. Eliminar `middleware.ts` si falla.
3. Restaurar variable de entorno anterior si el build falla.
4. Revertir última migración en Supabase.

## Dependencies
- `sdd/mvp-next-module/explore`.
- Guías de Next.js 16 en `node_modules/next/dist/docs/`.
- Acceso a Supabase para migraciones RLS.

## Success Criteria
- [ ] Middleware protege rutas privadas sin sesión.
- [ ] `requireRole(role)` rechaza inactivos y roles no autorizados.
- [ ] `npm run lint` y `npm run build` pasan.
- [ ] Variable de entorno usa `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [ ] `app/page.tsx` ya no consulta `projects`.
- [ ] Login incluye recuperación y estados.
- [ ] RLS permite lectura propia y update por admins activos.
