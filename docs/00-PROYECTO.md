# 00 — Proyecto

## Estado

**Proyecto:** Susotech Portal
**Versión:** MVP v0.1
**Estado:** En desarrollo
**Última actualización:** 2026-08-07

## Visión

Susotech Portal será el centro operativo de los trabajos de campo de Susotech. Reunirá en un mismo sistema la creación y asignación de trabajos, los planos y documentos, los códigos ejecutados, las fotografías, las evidencias, la revisión y la entrega a producción.

El producto debe sustituir procesos dispersos sin imponer complejidad innecesaria. La primera versión resolverá el flujo diario esencial y producirá una trazabilidad clara de quién hizo qué y cuándo.

## Problema que resuelve

La información de un trabajo puede quedar repartida entre mensajes, archivos, notas y conversaciones. Esto provoca:

- Dificultad para conocer el estado real de cada trabajo.
- Pérdida de documentos o evidencias.
- Asignaciones poco visibles.
- Errores en códigos, cantidades o tarifas.
- Falta de un historial confiable de revisiones y aprobaciones.
- Trabajo adicional para preparar producción y reportes.

## Propuesta de valor

- Una ficha única por trabajo.
- Acceso basado en responsabilidades.
- Documentos y evidencias vinculados al trabajo correcto.
- Flujo de estados predecible y auditable.
- Operación compatible con teléfono y escritorio.
- Base técnica preparada para crecer sin retrasar el MVP.

## Usuarios

### Administrador

Configura usuarios, roles, catálogos y parámetros. Tiene acceso amplio, pero las acciones sensibles deben permanecer auditadas.

### Coordinación u oficina

Crea trabajos, completa datos, carga documentos, asigna técnicos y da seguimiento hasta revisión y producción.

### Técnico

Consulta únicamente los trabajos que le corresponden y registra avances, códigos, cantidades, fotografías y evidencias.

### Supervisor o revisor

Revisa la entrega, devuelve observaciones o aprueba. Sus decisiones deben quedar registradas.

### Producción o finanzas

Consulta trabajos aprobados y la información operativa o económica autorizada para procesarlos.

## Principios del producto

1. Seguridad desde la base de datos.
2. Flujo simple antes que funciones avanzadas.
3. Trazabilidad por defecto.
4. Experiencia móvil para el trabajo de campo.
5. Datos estructurados en vez de texto libre cuando exista una regla de negocio.
6. Automatización posterior a la validación del proceso.

## Flujo principal

```mermaid
flowchart LR
    A[Crear trabajo] --> B[Asignar técnico]
    B --> C[Ejecutar y documentar]
    C --> D[Enviar a revisión]
    D -->|Correcciones| C
    D -->|Aprobado| E[Producción]
    E --> F[Completado]
```

## Indicadores de éxito

- Porcentaje de trabajos con estado actualizado.
- Tiempo desde asignación hasta revisión.
- Porcentaje de entregas aprobadas en la primera revisión.
- Cantidad de trabajos sin documento o evidencia requerida.
- Tiempo necesario para preparar un trabajo para producción.
- Incidentes de permisos o acceso indebido: objetivo cero.

## Restricciones del MVP

El MVP no incluirá edición visual de PDF, GPS en tiempo real, contabilidad completa ni aplicaciones móviles nativas. Los PDF se podrán almacenar y visualizar. El editor de marcadores se diseñará después de validar el flujo básico.

## Definición de terminado

El MVP se considera terminado cuando el flujo completo puede ejecutarse con permisos correctos, archivos privados, historial de estados, experiencia móvil funcional y verificaciones técnicas satisfactorias.

## Próximos pasos

- [ ] Validar nombres finales de roles.
- [ ] Confirmar campos obligatorios de un trabajo.
- [ ] Confirmar estados y transiciones.
- [ ] Completar autenticación y autorización.
- [ ] Construir el módulo de trabajos.
