# Documentación de Susotech Portal

Esta carpeta contiene la documentación oficial del proyecto. `PROJECT_PLAN.md` mantiene la visión consolidada; los demás documentos desarrollan cada área con mayor detalle.

## Índice

1. [Plan maestro](PROJECT_PLAN.md)
2. [Visión del proyecto](00-PROYECTO.md)
3. [Arquitectura](01-ARQUITECTURA.md)
4. [Tecnologías](02-TECNOLOGIAS.md)
5. [Base de datos](03-BASE-DE-DATOS.md)
6. [Seguridad](04-SEGURIDAD.md)
7. [Alcance del MVP](05-MVP.md)
8. [Roadmap](06-ROADMAP.md)
9. [Guía de desarrollo](07-GUIA-DE-DESARROLLO.md)
10. [Estándares](08-ESTANDARES.md)
11. [Checklist](09-CHECKLIST.md)
12. [Historial de cambios](CHANGELOG.md)
13. [Instrucciones para agentes](AGENTS.md)

## Estado actual

- Versión: MVP v0.1
- Estado: en desarrollo
- Stack confirmado: Next.js 16.3, React 19.2, TypeScript 5, Tailwind CSS 4 y Supabase.
- Implementado inicialmente: rutas de login y dashboard, cliente de Supabase y migraciones de perfiles/roles.
- Próximo foco: autenticación completa, autorización y modelo de trabajos.

## Cómo mantener la documentación

- Actualizar el documento temático afectado en el mismo cambio que modifica el código.
- Registrar en `CHANGELOG.md` las decisiones o entregas relevantes.
- Marcar una tarea en `09-CHECKLIST.md` solo después de verificarla.
- Si cambia el alcance, actualizar primero `PROJECT_PLAN.md` y `05-MVP.md`.
- Si cambia el esquema, actualizar `03-BASE-DE-DATOS.md` y agregar una migración.
- Si cambia un permiso, actualizar `04-SEGURIDAD.md` y sus pruebas de RLS.
