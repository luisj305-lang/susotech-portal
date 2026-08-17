# Production Codes Specification

## Purpose

Registrar códigos y cantidades ejecutadas en cada trabajo, con acceso acotado al catálogo visible según la categoría del técnico.

## Requirements

### Requirement: Registro de código y cantidad

Un técnico asignado o miembro del crew asignado MUST poder añadir un código de producción a un trabajo en estado `asignado` o `en_revision`. El código MUST ser no vacío y la cantidad MUST ser numérica y mayor que cero; notas MAY ser opcionales.

#### Scenario: Técnico registra una cantidad válida

- GIVEN un técnico asignado a un trabajo `asignado`
- WHEN añade un código no vacío con cantidad positiva
- THEN el registro MUST vincularse al trabajo y al actor

#### Scenario: Corrección en en_revision

- GIVEN un técnico asignado a un trabajo `en_revision`
- WHEN añade o corrige códigos
- THEN el registro MUST permitirse

#### Scenario: Cantidad inválida

- GIVEN un técnico asignado
- WHEN intenta registrar cantidad cero, negativa o no numérica
- THEN la operación MUST ser rechazada sin crear registro

### Requirement: Acceso acotado a códigos

Oficina MUST poder leer y administrar los códigos de los trabajos. Un técnico MUST poder leer y añadir códigos únicamente en trabajos asignados y en estado compatible, y MUST NOT alterar registros de trabajos ajenos.

#### Scenario: Consulta autorizada

- GIVEN un técnico asignado a un trabajo
- WHEN consulta los códigos del trabajo
- THEN MUST recibir los registros vinculados

#### Scenario: Escritura sobre trabajo ajeno

- GIVEN un técnico no asignado
- WHEN intenta añadir un código al trabajo
- THEN el servidor y RLS MUST rechazar la operación

### Requirement: Catálogo filtrado por categoría del técnico

El catálogo visible para el técnico MUST incluir únicamente ítems con tarifa activa de SU categoría de precio. El técnico MUST NOT ver ítems de otras categorías marcados como "Sin tarifa configurada".

#### Scenario: Técnico ve solo su categoría

- GIVEN un técnico con categoría `subcontractor`
- WHEN consulta el catálogo de códigos
- THEN MUST recibir solo ítems con tarifa activa de `subcontractor`

#### Scenario: Ítem sin tarifa queda oculto

- GIVEN un ítem activo sin tarifa para la categoría del técnico
- WHEN el técnico consulta el catálogo
- THEN el ítem MUST quedar fuera de los resultados

### Requirement: Contratista con categoría y tarifas carga códigos

Un técnico contractor con `price_category_id` y tarifas correctas para su categoría MUST poder cargar códigos sin errores de categoría o tarifa.

#### Scenario: Contractor carga códigos sin errores

- GIVEN un técnico contractor con categoría de precio configurada y tarifas de catálogo para su categoría
- WHEN carga un código en un trabajo `asignado`
- THEN la operación MUST completarse sin errores de categoría o tarifa
