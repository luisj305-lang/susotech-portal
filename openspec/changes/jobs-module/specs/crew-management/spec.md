# Crew Management Specification

## Purpose

Definir la experiencia administrativa para formar crews de técnicos y habilitarlos como responsables de trabajos.

## Requirements

### Requirement: Acceso y listado administrativo

Un `admin` o `supervisor` activo MUST disponer de un acceso visible a la gestión de crews y MUST poder consultar crews activos e inactivos con su nombre, responsable, miembros y estado. Otros roles MUST NOT acceder a sus controles administrativos.

#### Scenario: Oficina consulta crews

- GIVEN un `admin` o `supervisor` activo
- WHEN abre la gestión de crews
- THEN MUST ver el listado con responsable, miembros y estado de cada crew

#### Scenario: Estado vacío

- GIVEN que no existen crews
- WHEN oficina abre la gestión
- THEN MUST ver un estado vacío claro y una acción para crear el primer crew

#### Scenario: Técnico intenta administrar crews

- GIVEN un `tecnico` autenticado
- WHEN intenta abrir la gestión de crews
- THEN el sistema MUST denegar el acceso administrativo

### Requirement: Creación, edición y desactivación

Un `admin` o `supervisor` activo MUST poder crear y renombrar un crew, cambiar su responsable y desactivarlo. Cada crew MUST tener nombre y un responsable que sea un técnico activo. Un crew inactivo MUST NOT estar disponible para nuevas asignaciones.

#### Scenario: Oficina crea un crew

- GIVEN oficina y un técnico activo elegible
- WHEN guarda un nombre y designa al técnico como responsable
- THEN el crew MUST persistirse activo con esos datos

#### Scenario: Oficina edita un crew

- GIVEN un crew existente y otro técnico activo elegible
- WHEN oficina cambia el nombre o responsable y guarda
- THEN la vista MUST reflejar los datos actualizados

#### Scenario: Oficina desactiva un crew

- GIVEN un crew activo
- WHEN oficina confirma su desactivación
- THEN el crew MUST quedar inactivo
- AND MUST NOT aparecer como opción para nuevas asignaciones

### Requirement: Membresía controlada

Oficina MUST poder añadir y retirar técnicos activos de un crew sin duplicar la pareja crew-técnico. El responsable MUST pertenecer al crew. Perfiles no técnicos o inactivos MUST NOT aparecer como candidatos y MUST ser rechazados si se envían al servidor.

#### Scenario: Añadir y retirar miembros

- GIVEN un crew y técnicos activos elegibles
- WHEN oficina añade unos técnicos y retira otros
- THEN la membresía mostrada MUST coincidir con la selección guardada
- AND cada técnico MUST aparecer como máximo una vez

#### Scenario: Candidato no elegible

- GIVEN un perfil inactivo o con rol distinto de `tecnico`
- WHEN oficina busca candidatos o intenta añadir ese perfil
- THEN el perfil MUST NOT ser seleccionable
- AND la operación forzada MUST ser rechazada

#### Scenario: Cambio de responsable

- GIVEN un miembro técnico activo del crew
- WHEN oficina lo designa responsable
- THEN MUST quedar como responsable y continuar como miembro

### Requirement: Crew disponible para asignación

Todo crew activo válido MUST aparecer como responsable seleccionable donde oficina asigne trabajos individualmente o en bloque. Un técnico miembro MUST poder consultar trabajos asignados activamente a su crew según RLS.

#### Scenario: Asignar trabajo a crew administrado

- GIVEN un crew activo con responsable y miembros válidos
- WHEN oficina abre un selector de responsable de trabajos
- THEN el crew MUST aparecer como opción asignable

#### Scenario: Miembro consulta trabajo del crew

- GIVEN un técnico activo miembro de un crew con una asignación activa
- WHEN consulta sus trabajos
- THEN MUST recibir el trabajo asignado al crew
