# Job Evidence Specification

## Purpose

Vincular documentos y evidencia privada con el trabajo autorizado.

## Requirements

### Requirement: Almacenamiento privado

Los PDF de proyecto MUST almacenarse en `project-files` y las fotos en `job-evidence`; ambos buckets MUST ser privados. El cliente MUST acceder mediante autorización del trabajo y URLs firmadas de corta duración, sin recibir credenciales privilegiadas.

#### Scenario: Actor autorizado consulta un PDF

- GIVEN un usuario autorizado para el trabajo
- WHEN solicita visualizar el PDF
- THEN el sistema MUST entregar acceso temporal al objeto privado

#### Scenario: Actor ajeno solicita evidencia

- GIVEN un técnico no asignado al trabajo
- WHEN solicita el archivo o una URL firmada
- THEN el sistema MUST denegar el acceso

### Requirement: Evidencia fotográfica

Un técnico asignado MUST poder subir fotos `before`, `after` o `evidence`. Cada foto confirmada MUST registrar trabajo, ruta privada, tipo, autor y fecha, y MUST validar tipo y tamaño antes de aceptarse.

#### Scenario: Foto válida

- GIVEN un técnico asignado y una imagen admitida
- WHEN confirma la subida como `evidence`
- THEN el objeto y sus metadatos MUST quedar vinculados al trabajo

#### Scenario: Archivo no admitido

- GIVEN un archivo con formato o tamaño no permitido
- WHEN se intenta subir como foto
- THEN el sistema MUST rechazarlo sin crear metadatos confirmados

### Requirement: Consistencia ante fallos

Una subida fallida MUST NOT crear una evidencia utilizable sin objeto válido. El usuario SHOULD poder reintentar sin duplicar una carga ya confirmada.

#### Scenario: Subida interrumpida

- GIVEN una subida no confirmada por Storage
- WHEN ocurre un error de conectividad
- THEN el sistema MUST informar el fallo y permitir reintentar
