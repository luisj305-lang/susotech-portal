# Incident Tracking Specification

## Purpose

Registrar bloqueos operativos sin sustituir el estado principal del trabajo.

## Requirements

### Requirement: Incidencia separada del estado

Un trabajo MAY tener una incidencia `need_splicing`, `no_access`, `need_cr`, `permit_pending`, `returned` o `incomplete`. Crear, cambiar o resolver una incidencia MUST conservar `main_status` y MUST NOT combinarse con un cambio de estado en la misma operación.

#### Scenario: Técnico reporta bloqueo

- GIVEN un técnico asignado a un trabajo `en_progreso`
- WHEN registra `no_access` con notas
- THEN la incidencia MUST persistirse y el estado MUST seguir `en_progreso`

#### Scenario: Cambio combinado

- GIVEN un trabajo con estado e incidencia actuales
- WHEN se solicitan cambios simultáneos de estado e incidencia
- THEN el servidor MUST rechazar la operación completa

### Requirement: Gestión y auditoría de incidencias

Un técnico asignado MUST poder crear o resolver incidencias de su trabajo; oficina MUST poder gestionarlas en cualquier trabajo. Cada cambio MUST registrar valor anterior, valor nuevo, actor, fecha y notas aplicables.

#### Scenario: Técnico resuelve incidencia propia

- GIVEN un trabajo asignado con incidencia activa
- WHEN el técnico elimina la incidencia
- THEN el sistema MUST conservar el estado y añadir un evento de historial

#### Scenario: Técnico modifica trabajo ajeno

- GIVEN un técnico no asignado al trabajo
- WHEN intenta cambiar su incidencia
- THEN la operación MUST ser denegada sin historial nuevo
