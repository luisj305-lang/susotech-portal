# Bulk PDF Import Specification

## Purpose

Crear varios trabajos a partir de documentos PDF seleccionados por oficina.

## Requirements

### Requirement: Importación múltiple

Un `admin` o `supervisor` activo MUST poder seleccionar o arrastrar simultáneamente decenas o cientos de PDF. Antes de importar, la interfaz MUST crear una fila editable por archivo y extraer únicamente valores explícitos del documento para número de orden, dirección, cliente, fecha, tipo de trabajo, descripción y responsable sugerido. La sugerencia MUST NOT crear una asignación sin confirmación manual.

#### Scenario: Importación de varios PDF válidos

- GIVEN oficina selecciona `A.pdf` y `B.pdf`
- WHEN confirma la importación
- THEN MUST crearse un trabajo titulado `A` y otro titulado `B`
- AND cada trabajo MUST referenciar su PDF privado

#### Scenario: Archivo no PDF

- GIVEN una selección que contiene un archivo no permitido
- WHEN se valida la importación
- THEN ese archivo MUST rechazarse con un error identificable
- AND MUST NOT crear un trabajo para ese archivo

#### Scenario: Previsualización del documento real

- GIVEN oficina selecciona `6556114.pdf`
- WHEN finaliza el análisis local
- THEN la previsualización MUST mostrar PRISM `6556114`, fecha `2026-02-10`, dirección `1587 ShallCross Ave`, ubicación `Orlando, FL 32826` y tipo `Span Replacement`
- AND MUST mostrar `Wilfredo B.` solamente como sugerencia de responsable
- AND MUST dejar cliente vacío porque el documento no contiene un campo de cliente explícito

#### Scenario: Edición antes de confirmar

- GIVEN una fila analizada y pendiente
- WHEN oficina corrige un campo detectado
- THEN la importación MUST usar el valor confirmado
- AND MUST mantener el PDF y los demás campos sin cambios

### Requirement: Resultado recuperable y consultable

La interfaz MUST identificar el resultado por archivo, permitir reintentar fallos y mostrar los trabajos creados para su asignación. El listado de oficina MUST permitir buscar un trabajo importado por su título derivado del PDF.

#### Scenario: Resultado parcial

- GIVEN varios PDF y uno falla antes de confirmarse
- WHEN termina la importación
- THEN la interfaz MUST distinguir éxitos y fallo
- AND el reintento MUST NOT duplicar trabajos ya confirmados

#### Scenario: Búsqueda por nombre de PDF

- GIVEN un trabajo importado desde `Plano 42.pdf`
- WHEN oficina busca `Plano 42`
- THEN el listado MUST incluir ese trabajo

### Requirement: Procesamiento acotado y observable

La interfaz MUST aceptar lotes de 50 a 100 archivos, mostrar progreso general y un estado por archivo entre `pendiente`, `procesando`, `importado`, `duplicado` y `error`. El análisis, carga y confirmación MUST usar entre 3 y 5 cargas concurrentes y paginación, búsqueda o filtros para conservar una interacción utilizable. Un fallo MUST quedar aislado a su archivo.

#### Scenario: Fallo parcial

- GIVEN tres PDF válidos y un archivo inválido
- WHEN oficina confirma el lote
- THEN los PDF válidos MUST continuar hasta importado o duplicado
- AND el archivo inválido MUST quedar en error
- AND el progreso MUST reflejar los cuatro resultados

#### Scenario: Reintento acotado

- GIVEN un lote con trabajos importados y archivos en error
- WHEN oficina elige reintentar fallos
- THEN MUST procesarse únicamente las filas en error
- AND MUST NOT reenviar ni duplicar filas importadas o duplicadas

### Requirement: Duplicados e identidad del archivo

Cada importación confirmada MUST conservar el identificador real de orden cuando exista, nombre original, SHA-256, tamaño, usuario importador y fecha. El navegador MUST calcular SHA-256 antes de autorizar la carga y el sistema MUST deduplicar por el par hash+tamaño, no por título. El sistema MUST tratar como duplicado un identificador de orden confirmado o el mismo par hash+tamaño y MUST devolver el trabajo existente. Cada PDF confirmado MUST quedar en Storage privado bajo la ruta de exactamente un trabajo.

#### Scenario: Orden repetida con archivo diferente

- GIVEN una orden ya importada con identificador `6556114`
- WHEN oficina carga otro PDF que confirma el mismo identificador
- THEN el resultado MUST ser duplicado
- AND MUST referenciar el trabajo existente

#### Scenario: Archivo repetido con nombre diferente

- GIVEN un PDF ya importado
- WHEN oficina vuelve a cargar los mismos bytes con otro nombre
- THEN el SHA-256 MUST identificarlo como duplicado
- AND MUST NOT crear otro trabajo

#### Scenario: Mismo nombre con contenido diferente

- GIVEN dos PDF válidos con el mismo nombre original y distinto hash
- WHEN oficina confirma ambos
- THEN MUST poder crear dos trabajos distintos cuando sus identificadores de orden tampoco coinciden
- AND la auditoría MUST conservar el mismo nombre con sus hashes y tamaños diferentes

### Requirement: Transferencia directa y confirmación idempotente

Los bytes del PDF MUST viajar directamente del navegador al bucket privado `project-files` mediante una autorización firmada. Las Server Actions MUST aceptar únicamente metadatos serializables y MUST NOT aceptar `File`, `Blob`, `FormData`, `ArrayBuffer`, `Uint8Array` ni contenido PDF. Antes de autorizar, el cliente y el servidor MUST validar extensión `.pdf`, MIME `application/pdf`, tamaño permitido y cabecera declarada `%PDF-`. Después de cargar, una confirmación de servidor MUST verificar que el objeto privado existe, que su tamaño y MIME coinciden, y crear o devolver idempotentemente el trabajo.

#### Scenario: PDF real mayor al límite de Server Actions

- GIVEN `6556114.pdf` mide aproximadamente 4,005,680 bytes
- WHEN oficina lo importa
- THEN los bytes MUST cargarse directamente a Storage con una URL firmada
- AND las Server Actions MUST recibir solamente nombre, hash, tamaño, MIME, cabecera, identificadores y campos editados

#### Scenario: Interrupción y reanudación

- GIVEN una fila autorizada cuya carga o confirmación se interrumpe
- WHEN oficina vuelve a seleccionar el mismo archivo y reintenta
- THEN el sistema MUST recuperar el item por lote, hash y tamaño
- AND MUST reutilizar su identidad de importación sin crear otro trabajo

#### Scenario: Confirmación repetida

- GIVEN un item ya confirmado con un trabajo
- WHEN se repite la confirmación
- THEN MUST devolver el mismo trabajo
- AND MUST mantener exactamente una fila de importación y un PDF relacionado

#### Scenario: Validación antes de autorizar

- GIVEN un archivo con extensión, MIME o cabecera inválida
- WHEN solicita autorización
- THEN el servidor MUST rechazar los metadatos
- AND MUST NOT crear una autorización de Storage ni un trabajo
