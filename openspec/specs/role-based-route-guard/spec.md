# Role-Based Route Guard

## Purpose

Garantizar que solo usuarios activos con el rol correcto puedan acceder a funciones administrativas o específicas de rol.

## Requirements

### Requirement: Verificación de rol activo

`requireRole(role)` SHALL verificar que el perfil autenticado tenga el rol solicitado y esté activo.

- GIVEN un usuario `admin` activo que accede a `/usuarios`
- WHEN `requireAdmin()` valida el perfil
- THEN SHALL permitir el acceso

- GIVEN un usuario `tecnico` activo que accede a `/usuarios`
- WHEN `requireAdmin()` valida el perfil
- THEN SHALL redirigir a `/acceso-denegado`

### Requirement: Cuentas inactivas

`requireRole(role)` SHALL rechazar a usuarios cuya cuenta esté desactivada (`is_active = false`), independientemente del rol.

- GIVEN un usuario `admin` inactivo que accede a `/dashboard`
- WHEN `requireProfile()` o `requireAdmin()` valida el perfil
- THEN SHALL redirigir a `/acceso-denegado`

### Requirement: Roles soportados

El sistema SHALL soportar los roles `admin`, `supervisor` y `tecnico` en las verificaciones.

- GIVEN un usuario `supervisor` activo que accede a una ruta permitida para supervisores
- WHEN `requireRole('supervisor')` valida el perfil
- THEN SHALL permitir el acceso
