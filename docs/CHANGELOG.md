# Changelog

Todos los cambios relevantes de producto, arquitectura y documentación se registran aquí. El formato sigue los principios de Keep a Changelog y el proyecto utilizará versiones semánticas cuando comience a publicar entregas.

## [Unreleased]

### Added

- Documentación profesional inicial del proyecto.
- Plan maestro, arquitectura, tecnologías, base de datos y seguridad.
- Definición del MVP, roadmap, guía de desarrollo y estándares.
- Checklist operativo e instrucciones para agentes.
- Rutas iniciales de login y dashboard en el repositorio.
- Cliente inicial de Supabase.
- Migraciones iniciales para roles y nombres de perfil.

### Decisions

- Next.js, React, TypeScript, Tailwind CSS y Supabase forman el stack del MVP.
- PostgreSQL con RLS será la fuente de verdad y autorización.
- Los documentos se almacenarán en buckets privados.
- El MVP visualizará PDF, pero no incluirá marcadores ni exportación anotada.
- El editor visual de PDF se reserva para una fase posterior.

## Cómo actualizar

Agregar entradas bajo `Unreleased` en una de estas categorías:

- `Added`: capacidades nuevas.
- `Changed`: cambios visibles o decisiones modificadas.
- `Deprecated`: funciones que se retirarán.
- `Removed`: funciones eliminadas.
- `Fixed`: correcciones.
- `Security`: correcciones o mejoras de seguridad.
- `Decisions`: decisiones de arquitectura o alcance.

No registrar detalles triviales que ya quedan claros en el historial de Git.
