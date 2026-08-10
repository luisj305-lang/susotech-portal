# Bulk Assignment Specification

## Purpose

Asignar uno o varios trabajos a un técnico o crew con trazabilidad.

## Requirements

### Requirement: Asignación individual o masiva

Un `admin` o `supervisor` activo MUST poder elegir por fila un técnico activo o crew activo y aplicar una misma opción a varias filas seleccionadas antes de importar. Cada asignación confirmada MUST elegir exactamente un tipo de asignado y MUST registrar actor y fecha. Una sugerencia extraída del PDF MUST permanecer informativa hasta que oficina seleccione explícitamente una opción.

Después de confirmar los trabajos, el cliente MUST agrupar los trabajos nuevos por responsable seleccionado y MUST invocar el RPC atómico existente mediante la Server Action de asignación en bloques de hasta 100 IDs. Los bytes PDF MUST NOT formar parte de esas operaciones.

#### Scenario: Asignación masiva a crew

- GIVEN oficina selecciona varios trabajos y un crew activo
- WHEN confirma la asignación masiva
- THEN cada trabajo MUST tener una asignación activa al crew
- AND los miembros MUST poder verlo según RLS

#### Scenario: Responsables diferentes en el mismo lote

- GIVEN un lote con filas asignadas a dos técnicos y una cuadrilla diferentes
- WHEN termina la confirmación de trabajos
- THEN los IDs nuevos MUST agruparse por tipo e identificador de responsable
- AND cada grupo MUST asignarse con `assign_jobs_atomic` en bloques de hasta 100
- AND cada fila MUST conservar la selección individual confirmada

#### Scenario: Sugerencia no confirmada

- GIVEN el PDF menciona un supervisor o técnico reconocible
- WHEN oficina no selecciona un técnico ni crew
- THEN el trabajo MUST importarse sin asignación
- AND la sugerencia MUST NOT convertirse automáticamente en asignación

#### Scenario: Asignado ambiguo

- GIVEN una solicitud con técnico y crew simultáneamente
- WHEN se valida la asignación
- THEN la operación MUST ser rechazada

### Requirement: Reasignación coherente

Al reasignar, el sistema MUST desactivar la asignación primaria anterior antes de activar la nueva y MUST conservar el historial de asignaciones. Un fallo MUST NOT dejar más de una asignación primaria activa por trabajo.

#### Scenario: Reasignación individual

- GIVEN un trabajo asignado a un técnico
- WHEN oficina lo reasigna a un crew
- THEN la asignación anterior MUST quedar inactiva y la nueva activa

#### Scenario: Fallo durante lote

- GIVEN una selección con un trabajo no asignable
- WHEN la operación no puede satisfacer sus validaciones
- THEN el resultado MUST identificar el fallo
- AND cada trabajo MUST conservar una asignación primaria coherente

### Requirement: Autorización de asignación

Un técnico MUST poder leer sus asignaciones, pero MUST NOT crear, reasignar ni desactivar asignaciones.

#### Scenario: Técnico intenta reasignar

- GIVEN un técnico autenticado
- WHEN solicita cambiar el asignado de un trabajo
- THEN el servidor y RLS MUST denegar la operación
