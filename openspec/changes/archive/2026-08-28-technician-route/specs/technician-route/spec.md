# Especificación de Ruta de Técnico

## Purpose

Definir la ruta optimizada de conducción que un técnico obtiene desde su posición GPS actual para visitar todos sus trabajos pendientes (`asignado`), con autorización por rol `tecnico` y alcance RLS.

## Requirements

### Requirement: Conjunto de trabajos pendientes

El sistema MUST exponer al técnico el conjunto de trabajos pendientes: solo trabajos visibles por RLS (`can_access_job`), con `main_status='asignado'` y `archived_at is null`, ordenados por `deadline_date` ascendente.

#### Scenario: Técnico consulta sus pendientes

- GIVEN un técnico activo con trabajos asignados en distintos estados
- WHEN solicita sus trabajos pendientes
- THEN MUST devolver solo los `asignado` sin archivar visibles por RLS
- AND ordenados por `deadline_date` ascendente

#### Scenario: Trabajos ajenos excluidos

- GIVEN un técnico activo
- WHEN solicita sus pendientes
- THEN MUST NOT incluir trabajos asignados a otro técnico o a otra cuadrilla

### Requirement: Ubicación actual del técnico

El sistema MUST obtener la posición actual mediante geolocalización del navegador y SHOULD manejar los estados de error: permiso denegado, timeout, posición no disponible y navegador sin soporte.

#### Scenario: Permiso concedido

- GIVEN un técnico que acepta compartir ubicación
- WHEN solicita calcular la ruta
- THEN MUST usar su latitud/longitud actual como origen

#### Scenario: Permiso denegado

- GIVEN un técnico que deniega el permiso de ubicación
- WHEN solicita calcular la ruta
- THEN MUST mostrar un mensaje claro y no fallar

#### Scenario: Geolocalización no disponible

- GIVEN un navegador sin soporte de geolocalización, o un timeout
- WHEN el técnico intenta calcular la ruta
- THEN MUST mostrar un estado de error específico sin colapsar la página

### Requirement: Cálculo de ruta optimizada

El sistema MUST calcular un orden de visita optimizado sobre los trabajos pendientes partiendo del GPS actual (Google Routes, `optimizeWaypointOrder`, `DRIVE`). Los trabajos sin coordenadas MUST NOT bloquear la ruta: MUST excluirlos y mostrarlos.

#### Scenario: Ruta optimizada calculada

- GIVEN un técnico con ubicación y varios trabajos con coordenadas
- WHEN calcula la ruta
- THEN MUST devolver el orden de visita optimizado de esos trabajos

#### Scenario: Trabajos sin coordenadas

- GIVEN un técnico con al menos un trabajo pendiente sin coordenadas
- WHEN calcula la ruta
- THEN MUST excluir ese trabajo del cálculo
- AND MUST mostrar el trabajo excluido para que el técnico lo conozca

### Requirement: Autorización

Solo un perfil con rol `tecnico` MUST poder calcular y ver la ruta. El sistema MUST validar cada `jobIds` recibido contra el conjunto pendiente visible por RLS; un `jobIds` que no coincida MUST ser rechazado.

#### Scenario: Acceso correcto

- GIVEN un técnico activo
- WHEN solicita la página o calcula la ruta
- THEN MUST permitir el acceso

#### Scenario: Rol no autorizado

- GIVEN un `admin` o `supervisor` activo
- WHEN intenta acceder a la ruta de técnico
- THEN MUST redirigir a acceso denegado

#### Scenario: jobIds manipulados

- GIVEN un técnico que envía un `jobIds` con trabajos no visibles por RLS
- WHEN calcula la ruta
- THEN MUST rechazar la solicitud y no computar esos trabajos

### Requirement: Clave de Google ausente

Si `GOOGLE_MAPS_SERVER_API_KEY` no está configurada, el sistema MUST mostrar un mensaje claro de indisponibilidad y MUST NOT lanzar un error.

#### Scenario: Clave ausente

- GIVEN un técnico que calcula la ruta sin clave configurada
- WHEN el servidor intenta llamar a Google Routes
- THEN MUST devolver un mensaje claro de indisponibilidad sin colapsar

### Requirement: Enriquecimiento de coordenadas

Los trabajos pendientes con coordenadas nulas SHOULD ser enriquecidos mediante un RPC `SECURITY DEFINER` autorizado por `can_access_job`; si el enriquecimiento no es posible, MUST mostrarse y nunca ser fatal.

#### Scenario: Enriquecimiento exitoso

- GIVEN un trabajo pendiente con coordenadas nulas y dirección válida
- WHEN se solicita su enriquecimiento
- THEN SHOULD persistir latitud/longitud sin pasar por el trigger de escritura del técnico

#### Scenario: Enriquecimiento no disponible

- GIVEN un trabajo pendiente con coordenadas nulas que no puede geocodificarse
- WHEN se calcula la ruta
- THEN MUST excluirlo y mostrarlo, sin fallar la ruta
