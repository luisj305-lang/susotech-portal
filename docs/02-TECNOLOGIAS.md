# 02 — Tecnologías

## Stack confirmado

Las versiones listadas reflejan el `package.json` actual y deben actualizarse al cambiar dependencias.

| Tecnología | Versión actual | Uso |
|---|---:|---|
| Next.js | 16.3.0 | Aplicación web, rutas y renderizado. |
| React | 19.2.8 | Componentes e interacción. |
| TypeScript | 5.x | Tipado estático. |
| Tailwind CSS | 4.x | Sistema de estilos. |
| Supabase JS | 2.112.x | Auth, base de datos y Storage. |
| Supabase SSR | 0.12.x | Sesiones en entornos de servidor. |
| ESLint | 9.x | Calidad estática. |
| Node.js | 20+ recomendado | Herramientas y runtime compatible. |

## Next.js

Se elige por su integración entre interfaz y servidor, enrutamiento basado en archivos, renderizado flexible y buen encaje con Vercel.

Reglas:

- App Router como modelo principal.
- Componentes de servidor por defecto.
- APIs privadas solo en servidor.
- Revisar `node_modules/next/dist/docs/` antes de implementar APIs sensibles a versión.
- Evitar patrones heredados de versiones anteriores sin validarlos.

## TypeScript

Reduce errores en contratos de datos y facilita refactorizaciones. El proyecto debe conservar el modo estricto.

- No usar `any` como atajo.
- Modelar estados con uniones y tipos explícitos.
- Diferenciar tipos de base de datos, dominio y formulario cuando sus formas cambien.
- Validar datos externos en tiempo de ejecución; el tipado no sustituye la validación.

## Tailwind CSS

Permite construir una interfaz coherente con bajo coste de mantenimiento.

- Definir tokens para colores, espaciado y estados.
- Extraer componentes cuando un patrón se repita con significado.
- Mantener clases legibles y agrupar por función.
- Verificar contraste, foco y tamaños táctiles.

## Supabase

### Auth

Identidad y sesiones. `auth.users` es la fuente de identidad; `profiles` conserva información del negocio.

### PostgreSQL

Fuente de verdad de datos operativos. Se aprovecharán relaciones, restricciones, índices y transacciones.

### Row Level Security

Controla el acceso por fila desde la base de datos. Es obligatorio para tablas expuestas.

### Storage

Almacena PDF, fotos y evidencias en buckets privados con políticas basadas en usuario y trabajo.

## Vercel

Destino previsto para vistas previas y producción. Las variables de entorno deben configurarse por ambiente y nunca copiarse desde archivos locales al repositorio.

## Git y GitHub

Git mantiene el historial; GitHub permitirá ramas, revisión y automatización. El equipo debe preferir cambios pequeños y revisables.

## PDF.js

Tecnología prevista para visualización controlada de PDF. En el MVP su responsabilidad se limita a mostrar documentos; no habrá editor de marcadores ni exportación de anotaciones.

## Tecnologías por decidir

- Validación: evaluar Zod u opción equivalente según compatibilidad.
- Formularios: usar APIs nativas o una librería solo si reduce complejidad real.
- Pruebas: Vitest/Jest para unidad y Playwright para E2E son candidatos.
- Monitoreo: elegir antes de producción.
- Correo: seleccionar cuando se habiliten invitaciones y recuperación.

## Criterios para añadir dependencias

Antes de instalar una dependencia:

1. Confirmar el problema concreto.
2. Comprobar compatibilidad con las versiones instaladas.
3. Evaluar mantenimiento, tamaño y seguridad.
4. Comparar con APIs nativas o código simple.
5. Documentar por qué se adopta si afecta arquitectura.

## Actualizaciones

- No actualizar dependencias principales junto con una función no relacionada.
- Leer notas de versión y migración.
- Ejecutar lint, pruebas y build.
- Validar autenticación y renderizado después de cambios en Next.js o Supabase.
- Confirmar que el lockfile corresponde al `package.json`.
