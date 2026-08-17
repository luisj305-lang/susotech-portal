# Job Lifecycle Specification

## Purpose

Definir la creación, edición y progresión auditable de los trabajos con el flujo de estados `sin_asignar → asignado → en_revision → aprobado → facturado → pagado`.

## Requirements

### Requirement: Creación y edición por oficina

El sistema MUST permitir que un `admin` o `supervisor` activo cree y edite trabajos. Un trabajo MUST tener título y una categoría fija; la categoría MUST ser `categoria_1`, `categoria_2` o `categoria_3` y SHOULD usar `categoria_1` por defecto. El estado inicial MUST ser `sin_asignar`.

#### Scenario: Oficina crea un trabajo válido

- GIVEN un `supervisor` activo y datos con título
- WHEN crea un trabajo sin indicar categoría
- THEN el trabajo MUST persistirse con categoría `categoria_1`
- AND su estado MUST ser `sin_asignar`

#### Scenario: Rol no autorizado intenta crear

- GIVEN un `tecnico` autenticado
- WHEN intenta crear o editar un trabajo
- THEN la operación MUST ser rechazada sin persistir cambios

### Requirement: Máquina de estados

El sistema MUST aceptar únicamente `sin_asignar → asignado → en_revision → aprobado → facturado → pagado`. MUST permitir `en_revision → asignado` a oficina, con un motivo, y MUST NOT permitir que un técnico apruebe su entrega. Los estados `en_progreso`, `enviado_revision` y `listo_pagar` MUST NOT existir en código ni en la UI.

#### Scenario: Técnico entrega su trabajo

- GIVEN un técnico asignado a un trabajo `asignado`
- WHEN solicita entregarlo a revisión
- THEN la transición MUST completarse y el estado MUST ser `en_revision`

#### Scenario: Oficina aprueba

- GIVEN un trabajo `en_revision` y un `supervisor` activo
- WHEN aprueba la entrega
- THEN el estado MUST ser `aprobado`

#### Scenario: Oficina devuelve para corrección

- GIVEN un trabajo `en_revision` y un `supervisor` activo
- WHEN lo devuelve a `asignado` con un motivo
- THEN el estado MUST cambiar y el motivo MUST quedar auditado

#### Scenario: Transición inválida

- GIVEN un trabajo `sin_asignar`
- WHEN cualquier actor solicita cambiarlo directamente a `aprobado`
- THEN la transición MUST ser rechazada y el estado MUST conservarse

#### Scenario: Facturar exige número de factura

- GIVEN un trabajo `aprobado`
- WHEN se solicita `facturado` sin `invoice_number`
- THEN la transición MUST ser rechazada

### Requirement: Correcciones en en_revision

Un trabajo `en_revision` MUST seguir siendo editable por el técnico asignado para corregir códigos, fotos y evidencias antes de una nueva revisión.

#### Scenario: Técnico corrige en en_revision

- GIVEN un trabajo `en_revision` asignado al técnico
- WHEN el técnico corrige códigos o evidencias
- THEN el sistema MUST aceptar los cambios

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
