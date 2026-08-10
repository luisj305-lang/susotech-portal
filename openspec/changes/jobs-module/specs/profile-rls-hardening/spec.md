# Delta for Profile RLS Hardening

## ADDED Requirements

### Requirement: Acceso RLS a trabajos asignados

RLS SHALL permitir que un `admin` o `supervisor` activo administre trabajos y que un `tecnico` activo lea únicamente trabajos con asignación directa activa o asignación activa a uno de sus crews. Un usuario sin sesión o inactivo SHALL NOT acceder a trabajos.

#### Scenario: Técnico lee trabajo directo

- GIVEN un técnico activo con asignación directa activa
- WHEN selecciona el trabajo
- THEN SHALL recibir la fila asignada

#### Scenario: Técnico intenta leer trabajo ajeno

- GIVEN un técnico activo sin asignación directa ni de crew
- WHEN selecciona el trabajo
- THEN SHALL recibir cero filas

#### Scenario: Usuario inactivo conserva sesión

- GIVEN un usuario autenticado con `is_active = false`
- WHEN consulta trabajos
- THEN SHALL recibir cero filas

### Requirement: Acceso RLS a recursos del trabajo

Las políticas de asignaciones, historial, códigos, fotos y Storage SHALL heredar la autorización del trabajo. Un técnico asignado SHALL poder leer esos recursos y crear únicamente códigos, fotos y cambios operativos permitidos; MUST NOT administrar asignaciones ni trabajos ajenos.

#### Scenario: Técnico añade evidencia a trabajo propio

- GIVEN un técnico activo asignado al trabajo
- WHEN inserta metadatos válidos de una foto propia
- THEN RLS SHALL permitir la operación

#### Scenario: Técnico inserta código en trabajo ajeno

- GIVEN un técnico activo no asignado al trabajo
- WHEN intenta insertar un código de producción
- THEN RLS SHALL rechazar la operación

#### Scenario: Técnico intenta reasignar

- GIVEN un técnico activo asignado al trabajo
- WHEN intenta modificar `job_assignments`
- THEN RLS SHALL rechazar la escritura

### Requirement: Casos permitidos y denegados verificables

Cada política importante SHALL verificarse al menos con un caso permitido, uno sin rol, uno sin pertenencia, uno inactivo o sin sesión y uno que intente modificar campos no autorizados.

#### Scenario: Suite mínima de RLS

- GIVEN identidades representativas de oficina, técnico asignado, técnico ajeno e inactivo
- WHEN se ejecutan operaciones de lectura y escritura por recurso
- THEN cada resultado SHALL coincidir con su autorización sin usar `service_role` en el cliente
