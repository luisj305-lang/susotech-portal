# Job Invoicing Specification

## Purpose

Definir la facturación de trabajos aprobados, el registro del número de factura y el cierre del trabajo como pagado.

## Requirements

### Requirement: Facturación de trabajos aprobados

El sistema MUST permitir que un `admin` o `supervisor` activo facture un trabajo `aprobado`. La transición `aprobado → facturado` MUST exigir un `invoice_number` no vacío y MUST registrar `invoiced_at`.

#### Scenario: Facturar exige número de factura

- GIVEN un trabajo `aprobado`
- WHEN un `supervisor` solicita facturarlo sin `invoice_number`
- THEN la transición MUST ser rechazada y el estado MUST conservarse

#### Scenario: Facturación exitosa

- GIVEN un trabajo `aprobado` y un `invoice_number` no vacío
- WHEN el `supervisor` lo factura
- THEN el estado MUST pasar a `facturado`
- AND `invoiced_at` MUST quedar registrado

### Requirement: Corrección del número de factura

`invoice_number` SHALL ser texto libre, sin unicidad estricta. Un `admin` o `supervisor` activo MAY corregirlo mientras el estado no sea `pagado`.

#### Scenario: Corrección permitida antes del pago

- GIVEN un trabajo `facturado` con un `invoice_number` previo
- WHEN un `supervisor` corrige el número
- THEN el nuevo valor MUST persistir

#### Scenario: Corrección bloqueada tras el pago

- GIVEN un trabajo `pagado`
- WHEN cualquier actor intenta corregir `invoice_number`
- THEN la operación MUST ser rechazada

### Requirement: Archivar con factura

Al facturar, el sistema SHOULD ofrecer la opción "archivar con factura" para adjuntar el documento de factura al trabajo en Storage privado. Esta opción es OPCIONAL y no es requisito para llegar a `pagado`.

#### Scenario: Adjunto de factura al facturar

- GIVEN un trabajo `aprobado` y un archivo de factura válido
- WHEN el `supervisor` factura con la opción "archivar con factura"
- THEN el documento MUST quedar vinculado al trabajo en Storage privado

#### Scenario: Facturar sin adjuntar documento

- GIVEN un trabajo `aprobado`
- WHEN el `supervisor` factura sin adjuntar documento
- THEN el trabajo MUST llegar a `facturado` igualmente

### Requirement: Cierre como pagado

La transición `facturado → pagado` MUST cerrar el trabajo y solo puede ejecutarla un `admin` o `supervisor` activo.

#### Scenario: Marcar como pagado

- GIVEN un trabajo `facturado`
- WHEN el `supervisor` lo marca como pagado
- THEN el estado MUST ser `pagado`
- AND el trabajo MUST quedar cerrado para cambios de estado

### Requirement: Facturación independiente por parte

Cada parte MUST tener su propio `invoice_number` y MUST ejecutar la máquina `aprobado → facturado → pagado` de forma independiente. `pagado` en una parte MUST NOT cerrar las demás. Las partes MAY estar en estados distintos simultáneamente.

#### Scenario: Pago de una parte no cierra las demás

- GIVEN una raíz `facturado` y un hijo `asignado`
- WHEN se paga la raíz
- THEN la raíz MUST pasar a `pagado`
- AND el hijo MUST conservar su estado

#### Scenario: Número de factura por parte

- GIVEN dos partes
- WHEN cada una se factura
- THEN cada parte MUST llevar su propio `invoice_number`

### Requirement: Conteo único de partes en totales y reportes

`get_weekly_invoiced_total` y los reportes financieros/de producción MUST contar cada fila `jobs` exactamente una vez (raíz y cada hijo, una vez cada una), sin doble conteo ni fila paraguas.

#### Scenario: Deduplicación en totales

- GIVEN una raíz `pagado` con dos hijos `pagado`
- WHEN se calcula el total semanal
- THEN el total MUST contar tres unidades facturadas
- AND MUST NOT contar filas paraguas ni duplicados
