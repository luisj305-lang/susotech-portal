# Delta for job-invoicing

## ADDED Requirements

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
