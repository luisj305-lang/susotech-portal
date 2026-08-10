# Job Lifecycle Specification

## Purpose

Definir la creación, edición y progresión auditable de los trabajos.

## Requirements

### Requirement: Creación y edición por oficina

El sistema MUST permitir que un `admin` o `supervisor` activo cree y edite trabajos. Un trabajo MUST tener título, una categoría fija y estado inicial `asignado`; la categoría MUST ser `categoria_1`, `categoria_2` o `categoria_3` y SHOULD usar `categoria_1` por defecto.

#### Scenario: Oficina crea un trabajo válido

- GIVEN un `supervisor` activo y datos con título
- WHEN crea un trabajo sin indicar categoría
- THEN el trabajo MUST persistirse con categoría `categoria_1`
- AND su estado MUST ser `asignado`

#### Scenario: Rol no autorizado intenta crear

- GIVEN un `tecnico` autenticado
- WHEN intenta crear o editar un trabajo
- THEN la operación MUST ser rechazada sin persistir cambios

### Requirement: Máquina de estados

El sistema MUST aceptar únicamente `asignado → en_progreso → enviado_revision → aprobado → listo_pagar → pagado`. También MUST permitir `enviado_revision → en_progreso` a oficina, con un motivo, y MUST NOT permitir que un técnico apruebe su entrega.

#### Scenario: Técnico avanza su trabajo

- GIVEN un técnico asignado a un trabajo `asignado`
- WHEN solicita cambiarlo a `en_progreso`
- THEN la transición MUST completarse

#### Scenario: Transición inválida

- GIVEN un trabajo `asignado`
- WHEN cualquier actor solicita cambiarlo directamente a `aprobado`
- THEN la transición MUST ser rechazada y el estado MUST conservarse

#### Scenario: Oficina devuelve para corrección

- GIVEN un trabajo `enviado_revision` y un `supervisor` activo
- WHEN lo devuelve a `en_progreso` con un motivo
- THEN el estado MUST cambiar y el motivo MUST quedar auditado

### Requirement: Historial auditable

Cada cambio de estado MUST registrar trabajo, estado anterior, estado nuevo, actor, fecha y notas aplicables. Los eventos de historial MUST ser append-only para usuarios ordinarios.

#### Scenario: Cambio exitoso queda registrado

- GIVEN una transición autorizada
- WHEN el estado se actualiza
- THEN el sistema MUST añadir exactamente un evento atribuible al actor

#### Scenario: Cambio rechazado no genera evento

- GIVEN una transición no autorizada
- WHEN el servidor la rechaza
- THEN el sistema MUST NOT añadir historial ni modificar el trabajo
