# Production Codes Specification

## Purpose

Registrar códigos y cantidades ejecutadas en cada trabajo.

## Requirements

### Requirement: Registro de código y cantidad

Un técnico asignado o miembro del crew asignado MUST poder añadir un código de producción a un trabajo en ejecución. El código MUST ser no vacío y la cantidad MUST ser numérica y mayor que cero; notas MAY ser opcionales.

#### Scenario: Técnico registra una cantidad válida

- GIVEN un técnico asignado a un trabajo `en_progreso`
- WHEN añade un código no vacío con cantidad positiva
- THEN el registro MUST vincularse al trabajo y al actor

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
