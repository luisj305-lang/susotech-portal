# Technician Field View Specification

## Purpose

Proveer al técnico una experiencia móvil para ejecutar solo los trabajos que le corresponden.

## Requirements

### Requirement: Lista de trabajos asignados

La vista `/trabajos` para un `tecnico` activo MUST mostrar únicamente asignaciones activas directas o de crews a los que pertenece. La lista MUST exponer estado, incidencia y datos operativos esenciales, con estados de carga, vacío y error.

#### Scenario: Técnico tiene asignaciones mixtas

- GIVEN un técnico con una asignación directa y otra mediante crew
- WHEN abre `/trabajos`
- THEN MUST ver ambos trabajos y ningún trabajo ajeno

#### Scenario: Técnico sin trabajos

- GIVEN un técnico activo sin asignaciones activas
- WHEN abre `/trabajos`
- THEN MUST ver un estado vacío comprensible

### Requirement: Detalle operativo móvil

El detalle MUST permitir al técnico asignado consultar instrucciones y documentos, iniciar el trabajo, gestionar incidencias, registrar códigos, fotos y comentarios, y enviarlo a revisión. Los controles MUST ser táctiles, accesibles por teclado y no depender solo del color.

#### Scenario: Técnico ejecuta trabajo propio

- GIVEN un técnico asignado a un trabajo `asignado`
- WHEN abre el detalle y selecciona iniciar
- THEN el sistema MUST solicitar la transición autorizada a `en_progreso`

#### Scenario: Técnico abre trabajo ajeno

- GIVEN un técnico no asignado al trabajo solicitado
- WHEN abre `/trabajos/{id}`
- THEN el sistema MUST impedir mostrar datos o ejecutar acciones

### Requirement: Errores recuperables

Las acciones de campo MUST comunicar éxito o error sin perder entradas no confirmadas. Una operación fallida MAY reintentarse, pero MUST NOT duplicar registros confirmados.

#### Scenario: Falla temporal de red

- GIVEN un técnico con una carga pendiente
- WHEN la operación falla antes de confirmarse
- THEN la interfaz MUST conservar contexto y ofrecer reintento
