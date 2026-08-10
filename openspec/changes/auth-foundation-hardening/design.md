# Diseño: Endurecimiento de la base de autenticación y autorización

## Technical Approach

Usar la convención `proxy.ts` de Next.js 16 para ejecutar lógica de autenticación en el edge antes del render. Renombrar el helper `src/lib/supabase/proxy.ts` a `src/lib/supabase/update-session.ts` y consumirlo desde `proxy.ts` raíz. Extender `src/lib/auth/session.ts` con un guard genérico `requireRole(role)` que valide rol y cuenta activa. Unificar la variable de entorno a `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Mantener `/` como landing pública y redirigir a `/dashboard` solo tras login exitoso. Crear página dedicada `/reset-password` para recuperación de contraseña. Endurecer las políticas RLS de `profiles` mediante una nueva migración.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|---|---|---|
| `proxy.ts` raíz (Next.js 16) | `middleware.ts` | Next.js 16 deprecó `middleware.ts` y lo renombró a `proxy.ts`. La API sigue siendo `NextRequest`/`NextResponse`, pero el archivo debe llamarse `proxy.ts` y exportar `proxy()`. |
| Helper `update-session.ts` | Lógica directa en `proxy.ts` | Mover la lógica de refresco a `src/lib/supabase/update-session.ts` permite reutilizarla en Server Components si es necesario y evita confusión con el archivo `proxy.ts` raíz. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Mantener `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Alinea con la documentación del proyecto y la convención común de Supabase; se valida contra `@supabase/ssr` antes de cambiar. |
| `requireRole(role)` genérico | Un helper por rol | Reduce duplicación y facilita añadir `supervisor` más adelante. `requireAdmin()` se conserva como alias. |
| Inactividad en RLS y en helper | Solo en helper o solo en RLS | La aplicación debe rechazar rápido con redirect; RLS debe bloquear el acceso directo a la API. Doble verificación. |
| Landing pública en `/` | Auto-redirigir `/` a `/dashboard` | El usuario confirmó que `/` debe seguir siendo pública; solo se redirige a `/dashboard` después del login. |
| `/reset-password` dedicada | Formulario dentro de `/login` | El usuario confirmó que el enlace del email debe llevar a una página dedicada y, tras el cambio, redirigir a `/login`. |
| Token de recuperación en hash (`#`) | Query string (`?token=...`) | Supabase Auth entrega la sesión de recuperación en el fragmento hash (`access_token`, `refresh_token`, `type=recovery`). El hash no viaja al servidor ni queda en logs/referrers, y `@supabase/auth-js` lo parsea, limpia con `window.location.hash = ''` y emite `PASSWORD_RECOVERY`. |
| Cliente de recuperación con `flowType: 'implicit'` | Reutilizar `createBrowserClient` global | `@supabase/ssr` fuerza `flowType: 'pkce'` en `createBrowserClient`, pero los enlaces de recuperación usan implicit grant. Si el cliente está en PKCE, `_getSessionFromURL` rechaza el hash con `AuthPKCEGrantCodeExchangeError`. La página `/reset-password` crea su propio cliente con `createClient` de `@supabase/supabase-js` y `flowType: 'implicit'`. |

## Data Flow

```
Navegador ──► proxy.ts ──► updateSession(update-session.ts) ──► ¿ruta privada + sin sesión? ──► /login
                                │
                                ▼
                        Cookie refrescada ──► Server Component
                                │
                                ▼
                        requireRole(role) ──► createClient(server.ts) ──► Supabase RLS
                                │
                                ▼
                        Render / redirect a /acceso-denegado
```

## File Changes

| File | Action | Description |
|---|---|---|
| `proxy.ts` | Create | Archivo raíz de Next.js 16 que invoca `updateSession` y protege rutas privadas. |
| `src/lib/supabase/update-session.ts` | Create | Helper con la lógica actual de `proxy.ts` (refresco + protección). |
| `src/lib/supabase/proxy.ts` | Delete | Se reemplaza por `update-session.ts` para evitar confusión con `proxy.ts` raíz. |
| `src/lib/supabase/client.ts` | Modify | Renombrar variable de entorno a `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `src/lib/supabase/server.ts` | Modify | Renombrar variable de entorno a `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `src/lib/auth/session.ts` | Modify | Añadir `requireRole(role)`, actualizar `requireAdmin()`, reforzar inactividad. |
| `app/layout.tsx` | Modify | Actualizar metadata a "Susotech Portal". |
| `app/page.tsx` | Modify | Eliminar consulta a `projects`; mantener `/` como landing pública. |
| `app/login/page.tsx` | Modify | Añadir estados de carga/error, redirigir a `/dashboard` tras login, enlace a `/reset-password`. |
| `app/reset-password/page.tsx` | Create | Client Component que crea un cliente de Supabase con `flowType: 'implicit'` usando `createClient` de `@supabase/supabase-js`, deja que el SDK extraiga la sesión del hash (`#access_token=...&type=recovery`), escucha `PASSWORD_RECOVERY` / consulta `getSession()` y permite llamar `updateUser({ password })`. |
| `app/dashboard/page.tsx` | Modify | Añadir estados de carga y error. |
| `app/usuarios/page.tsx` | Modify | Añadir estados de carga y error. |
| `supabase/migrations/20260809..._harden_profile_rls.sql` | Create | Políticas RLS: lectura propia, lectura/escritura admin, bloqueo a inactivos. |

## Interfaces / Contracts

```typescript
// src/lib/auth/session.ts
export async function requireRole(role: UserRole): Promise<CurrentProfile>;
export async function requireAdmin(): Promise<CurrentProfile>;
export async function requireProfile(): Promise<CurrentProfile>;

// proxy.ts config
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

// src/lib/supabase/update-session.ts
export async function updateSession(request: NextRequest): Promise<NextResponse>;
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `requireRole` logic | No runner disponible; verificación manual con perfiles de prueba. |
| Integration | Proxy redirects + RLS policies | Pruebas manuales con cada rol en navegador y llamadas directas a Supabase. |
| E2E | Login → dashboard → logout → access denied → reset password | Verificación manual del flujo completo. |

## Threat Matrix

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No se ejecutan archivos basados en extensiones ni documentos como código. |
| Git repository selection | N/A | El cambio no invoca `git` ni selecciona repositorios. |
| Commit state | N/A | No automatiza commits ni modifica el índice de Git. |
| Push state | N/A | No ejecuta `git push` ni resuelve refs. |
| PR commands | N/A | No genera ni modifica pull requests. |

## Migration / Rollout

1. Añadir `NEXT_PUBLIC_SUPABASE_ANON_KEY` a `.env.local` (conservar la anterior temporalmente).
2. Desplegar código con `proxy.ts` y variables renombradas.
3. Aplicar la migración RLS en Supabase.
4. Verificar acceso con usuarios de cada rol e inactivos.
5. Eliminar la variable anterior de `.env.local` una vez validado.

Si falla, revertir commits, eliminar `proxy.ts` y revertir la migración en Supabase.

## Resolved Questions

- [x] ¿La página `/reset-password` debe aceptar el token por query string (`?token=...`) o por hash (`#token`)?
  - **Respuesta:** por hash. Supabase Auth entrega la sesión de recuperación en el fragmento hash de la URL (`access_token`, `refresh_token`, `expires_in`, `token_type`, `type=recovery`), no en query string. `@supabase/auth-js` lo procesa automáticamente al inicializar el cliente, limpia el hash y emite el evento `PASSWORD_RECOVERY`.
- [x] ¿Qué cliente de Supabase debe usar `/reset-password` para procesar el hash de recuperación?
  - **Respuesta:** un cliente creado directamente con `createClient` de `@supabase/supabase-js` y `auth.flowType: 'implicit'`. `createBrowserClient` de `@supabase/ssr` fuerza `flowType: 'pkce'`, que rechaza los enlaces de recuperación porque son implicit grant. El cliente de recuperación debe ser de página (no singleton) y tener `detectSessionInUrl: true`. El resto del portal sigue usando el cliente PKCE normal para OAuth y sesión.
