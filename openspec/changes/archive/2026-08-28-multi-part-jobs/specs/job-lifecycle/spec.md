# Delta for job-lifecycle

## ADDED Requirements

### Requirement: Archivado y borrado con partes

La relación `parent_job_id` MUST usar `ON DELETE RESTRICT`: el sistema MUST NOT permitir borrar una raíz que tenga hijos. El archivado MUST ser por trabajo e independiente entre partes: archivar una raíz MUST NOT archivar sus hijos. La acción "Agregar otra parte" MUST quedar bloqueada u oculta en trabajos archivados.

#### Scenario: Borrado de raíz con hijos bloqueado

- GIVEN una raíz con hijos
- WHEN se intenta borrar la raíz
- THEN MUST ser rechazada (RESTRICT)

#### Scenario: Archivar raíz no archiva hijos

- GIVEN una raíz con hijos abiertos
- WHEN se archiva la raíz
- THEN la raíz MUST quedar archivada
- AND los hijos MUST permanecer sin archivar

#### Scenario: Parte bloqueada en archivados

- GIVEN un trabajo archivado
- WHEN se consulta la UI
- THEN "Agregar otra parte" MUST quedar bloqueada u oculta
