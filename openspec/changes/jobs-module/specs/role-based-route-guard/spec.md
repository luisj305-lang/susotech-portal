# Delta for Role-Based Route Guard

## MODIFIED Requirements

### Requirement: Verificación de rol activo

`requireRole(role)` SHALL verificar que el perfil autenticado tenga el rol solicitado y esté activo. `requireSupervisor()` SHALL permitir a `admin` y `supervisor` activos acceder a funciones de oficina de trabajos, mientras el técnico autenticado SHALL usar únicamente la vista de campo autorizada.

(Previously: la verificación protegía funciones existentes por rol, sin definir las rutas de oficina y campo de trabajos.)

#### Scenario: Admin accede a usuarios

- GIVEN un usuario `admin` activo que accede a `/usuarios`
- WHEN `requireAdmin()` valida el perfil
- THEN SHALL permitir el acceso

#### Scenario: Técnico no accede a usuarios

- GIVEN un usuario `tecnico` activo que accede a `/usuarios`
- WHEN `requireAdmin()` valida el perfil
- THEN SHALL redirigir a `/acceso-denegado`

#### Scenario: Supervisor accede a gestión de trabajos

- GIVEN un usuario `supervisor` activo que accede a `/trabajos/nuevo`
- WHEN `requireSupervisor()` valida el perfil
- THEN SHALL permitir el acceso

#### Scenario: Técnico no accede a gestión de oficina

- GIVEN un usuario `tecnico` activo que accede a `/trabajos/importar`
- WHEN el guard valida el perfil
- THEN SHALL redirigir a `/acceso-denegado`

### Requirement: Roles soportados

El sistema SHALL soportar los roles `admin`, `supervisor` y `tecnico` en las verificaciones, y SHALL resolver `/trabajos` y `/trabajos/{id}` a la experiencia y datos autorizados para el rol activo.

(Previously: los tres roles eran soportados, sin conducta explícita para las vistas compartidas de trabajos.)

#### Scenario: Supervisor accede a ruta permitida

- GIVEN un usuario `supervisor` activo que accede a una ruta permitida para supervisores
- WHEN `requireRole('supervisor')` valida el perfil
- THEN SHALL permitir el acceso

#### Scenario: Técnico accede a su vista de campo

- GIVEN un usuario `tecnico` activo que accede a `/trabajos`
- WHEN el sistema valida su perfil
- THEN SHALL mostrar la vista técnica sin funciones de oficina
