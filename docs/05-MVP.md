# 05 — MVP

## Propósito

El MVP valida el ciclo operativo completo de un trabajo sin incluir módulos avanzados. El criterio no es la cantidad de pantallas, sino que un trabajo real pueda pasar de creación a producción con seguridad y trazabilidad.

## Alcance incluido

### Acceso

- Inicio y cierre de sesión.
- Sesión persistente y renovación correcta.
- Rutas privadas.
- Perfil y rol activo.
- Experiencia básica de acceso denegado.

### Trabajos

- Crear, listar, consultar y editar.
- Identificador de trabajo único.
- Estado, prioridad, fechas y datos básicos.
- Búsqueda y filtros esenciales.
- Asignación de técnicos.
- Historial de estados.

### Ejecución de campo

- Vista de trabajos asignados.
- Registro de códigos y cantidades.
- Notas operativas.
- Fotografías y evidencias.
- Envío a revisión.

### Documentos

- Carga segura de PDF.
- Visualización dentro del portal.
- Archivos complementarios.
- Buckets privados y acceso temporal.

### Revisión

- Cola de trabajos en revisión.
- Aprobación o solicitud de correcciones.
- Comentario obligatorio al devolver.
- Registro de usuario y fecha.
- Paso controlado a producción.

## Historias críticas

### Oficina crea y asigna

Como coordinador, quiero crear un trabajo y asignarlo para que el técnico conozca el alcance y los documentos requeridos.

Aceptación:

- Los campos obligatorios se validan.
- El número no se duplica.
- Solo un rol permitido crea o asigna.
- El técnico ve el trabajo después de asignarlo.
- El evento queda registrado.

### Técnico documenta

Como técnico, quiero registrar códigos, cantidades, fotos y notas para entregar evidencia completa.

Aceptación:

- Solo puede modificar trabajos asignados y en estado compatible.
- Los archivos se relacionan con el trabajo.
- Las cantidades inválidas se rechazan.
- Puede revisar lo cargado antes de enviar.

### Supervisor revisa

Como supervisor, quiero aprobar o devolver un trabajo para controlar calidad antes de producción.

Aceptación:

- Solo revisa trabajos enviados.
- Una devolución requiere motivo.
- La aprobación registra usuario y fecha.
- Un técnico no puede autoaprobar salvo política expresa.

## Fuera de alcance

- Marcadores o dibujo sobre PDF.
- Exportación de PDF anotado.
- QuickBooks.
- GPS en tiempo real.
- Nómina o facturación completa.
- App nativa.
- Flujos configurables por cliente.
- Panel analítico avanzado.

## Criterios no funcionales

- Interfaz usable desde móvil.
- Autorización aplicada por RLS.
- Archivos privados.
- Páginas críticas con estados de carga y error.
- Lint y build correctos.
- Flujo principal probado de extremo a extremo.
- Errores inesperados observables sin exponer secretos.

## Entrega incremental

1. Acceso y roles.
2. Trabajos y asignaciones.
3. Documentos y evidencias.
4. Códigos y cantidades.
5. Revisión y aprobación.
6. Producción y estabilización.

Cada incremento debe ser demostrable y no depender de funciones futuras.

## Condiciones para cambiar alcance

Una función entra al MVP solo si es indispensable para completar el flujo principal, tiene responsable, criterios de aceptación y coste evaluado. Si puede operarse temporalmente de forma manual sin comprometer seguridad o integridad, se programa para después.

## Salida del MVP

- [ ] Todos los criterios críticos aceptados.
- [ ] Pruebas de RLS completadas.
- [ ] Prueba piloto con usuarios representativos.
- [ ] Incidencias críticas resueltas.
- [ ] Documentación operativa actualizada.
- [ ] Respaldo, despliegue y reversión verificados.
