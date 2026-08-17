# Delta for Role-Based Route Guard

## ADDED Requirements

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
