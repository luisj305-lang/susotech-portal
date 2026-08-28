# Multi-Part Jobs Specification

## Purpose

Permitir que un trabajo gane partes adicionales independientes que comparten cliente/domicilio/PRISM, mediante una relación padre/hijo de un solo nivel sobre `jobs` (`parent_job_id`). Cada parte es una fila `jobs` facturable por sí misma y reutiliza la máquina existente (asignación, entrega, reparto, facturación, archivado). `job_stages` queda fuera de alcance y permanece inactivo.

## Requirements

### Requirement: Modelo de partes padre/hijo

El sistema MUST modelar las partes con una columna nullable `jobs.parent_job_id` (self-FK) hacia una raíz. La raíz MUST ser la "parte 1" y el agrupador; las partes adicionales MUST ser hijos planos de UN solo nivel. Cada fila `jobs` MUST ser exactamente una parte facturable; MUST NOT existir una fila padre no facturable separada. Un trabajo sin hijos MUST ser una raíz autónoma.

#### Scenario: Raíz autónoma sin hijos

- GIVEN un trabajo recién creado sin hijos
- WHEN se modela
- THEN `parent_job_id` MUST ser NULL
- AND el trabajo MUST facturarse como una parte única

#### Scenario: Partes planas de un nivel

- GIVEN una raíz con dos partes adicionales
- WHEN se consulta la jerarquía
- THEN ambas partes MUST apuntar a la misma raíz
- AND MUST NOT existir anidamiento mayor a un nivel

### Requirement: Copia de campos compartidos al crear una parte

Al crear una parte, el sistema MUST copiar desde la raíz cliente, domicilio, PRISM, título, categoría, ubicación y tipo de trabajo. La parte hija MUST quedar autocontenida: un técnico asignado a la parte MUST ver todo en su propia fila sin leer la raíz.

#### Scenario: Parte autocontenida

- GIVEN una raíz con cliente, domicilio, PRISM, título, categoría, ubicación y tipo de trabajo definidos
- WHEN oficina crea una parte hija
- THEN la parte MUST copiar esos campos
- AND el técnico de la parte MUST verlos en la fila de la parte

### Requirement: Guardas de integridad de la jerarquía

El sistema MUST rechazar `parent_job_id = id`. Solo las raíces MUST poder ser padre: una fila MUST poder tener hijos únicamente si su propio `parent_job_id` es NULL. El resultado MUST ser un árbol plano de un nivel sin ciclos. Estas guardas MUST aplicarse en la base de datos.

#### Scenario: Auto-padre rechazado

- GIVEN una fila con `parent_job_id = id`
- WHEN se intenta persistir
- THEN MUST ser rechazada

#### Scenario: Hijo no puede ser padre

- GIVEN una fila con `parent_job_id` no NULL
- WHEN se intenta asignarla como padre de otra
- THEN MUST ser rechazada

### Requirement: Agregar otra parte

El sistema MUST exponer "Agregar otra parte" solo a personal de oficina (`admin`/`supervisor`) y solo en trabajos no archivados, en cualquier momento, sin depender del estado de pago de la raíz. MUST clonar los campos compartidos de la raíz en una nueva fila con `main_status = 'sin_asignar'` y `parent_job_id = raíz`, en una única transacción. MUST NOT copiar la asignación: la parte nueva MUST iniciar sin asignar.

#### Scenario: Parte creada en cualquier momento

- GIVEN una raíz pagada y no archivada
- WHEN oficina agrega otra parte
- THEN la parte MUST crearse con `sin_asignar` y sin asignación
- AND los campos compartidos MUST copiarse

#### Scenario: Rol no autorizado

- GIVEN un técnico autenticado
- WHEN intenta agregar otra parte
- THEN MUST ser rechazada

#### Scenario: Trabajo archivado

- GIVEN un trabajo archivado
- WHEN se intenta agregar otra parte
- THEN MUST ser rechazada

### Requirement: Agrupación de partes en listas

En las listas de oficina y de técnico, el sistema MUST agrupar las partes hijas bajo su raíz e indicar cada una con un rótulo "Parte N". Una raíz autónoma MAY mostrarse sin rótulo.

#### Scenario: Agrupación y rótulo

- GIVEN una raíz con dos hijos
- WHEN se lista
- THEN las tres filas MUST agruparse bajo la raíz
- AND cada una MUST mostrar su rótulo "Parte N"
