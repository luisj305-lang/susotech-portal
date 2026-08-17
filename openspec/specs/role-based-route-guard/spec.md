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

### Requirement: Permisos de supervisor sobre trabajos

Un `supervisor` activo MUST poder archivar trabajos (`set_job_archived`) y eliminar trabajos archivados (`delete_archived_job`). La gestión de precios, tarifas y usuarios MUST permanecer exclusiva de `admin`.

#### Scenario: Supervisor archiva un trabajo

- GIVEN un `supervisor` activo y un trabajo elegible
- WHEN archiva el trabajo
- THEN la operación MUST completarse

#### Scenario: Supervisor elimina un trabajo archivado

- GIVEN un `supervisor` activo y un trabajo archivado
- WHEN lo elimina
- THEN la operación MUST completarse

#### Scenario: Técnico no puede archivar ni eliminar

- GIVEN un `tecnico` activo
- WHEN intenta archivar o eliminar un trabajo
- THEN la operación MUST ser rechazada en servidor y RLS

#### Scenario: Precios y usuarios siguen siendo admin-only

- GIVEN un `supervisor` activo
- WHEN intenta gestionar tarifas de catálogo o usuarios
- THEN la operación MUST ser rechazada

#### Scenario: Supervisor inactivo no puede archivar

- GIVEN un perfil `supervisor` con `is_active = false`
- WHEN intenta archivar un trabajo
- THEN la operación MUST ser rechazada
