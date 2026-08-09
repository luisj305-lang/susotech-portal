# 08 — Estándares

## Principios

- Claridad sobre ingenio.
- Seguridad sobre conveniencia.
- Cambios pequeños y verificables.
- Reutilización después de observar repetición real.
- Documentación junto al cambio.

## Idioma y nombres

- Código, tablas, columnas y commits: inglés.
- Interfaz y documentación para usuarios: español, salvo decisión de producto.
- Componentes React: `PascalCase`.
- Funciones y variables: `camelCase`.
- Constantes globales: `UPPER_SNAKE_CASE` cuando sean realmente constantes.
- Archivos de rutas según convenciones de Next.js.
- Tablas y columnas SQL: `snake_case`.
- Booleanos con prefijos claros: `is_`, `has_`, `can_`.

## TypeScript

- Modo estricto.
- Evitar `any` y conversiones inseguras.
- Preferir tipos discriminados para estados.
- No usar aserciones para ocultar datos posiblemente nulos.
- Exportar solo lo necesario.
- Mantener funciones con entradas y resultados claros.

## React y Next.js

- Componente de servidor por defecto.
- Añadir `use client` únicamente en el límite interactivo.
- No ejecutar efectos para datos que pueden derivarse durante renderizado.
- Mantener lógica de negocio fuera de JSX.
- Proporcionar estados de carga, vacío y error.
- Consultar documentación de la versión instalada.

## Componentes

- Una responsabilidad principal.
- Props pequeñas y explícitas.
- Composición antes que configuraciones gigantes.
- No duplicar controles críticos de permisos dentro de múltiples componentes.
- Componentes UI genéricos no deben conocer reglas del negocio.

## Accesibilidad

- HTML semántico.
- Etiquetas asociadas a controles.
- Navegación completa por teclado.
- Indicador visible de foco.
- Contraste suficiente.
- Errores asociados al campo.
- No depender solo del color.
- Objetivos táctiles adecuados.

## SQL

- UUID y claves foráneas explícitas.
- Restricciones `not null`, `check` y `unique` cuando apliquen.
- `timestamptz` para eventos.
- `numeric` para dinero y cantidades exactas.
- RLS y políticas revisadas.
- Índices justificados por consultas.
- Migraciones acumulativas.

## Errores y logs

- Mensajes útiles para el usuario sin detalles internos.
- Conservar causa técnica en registros protegidos.
- No registrar tokens, claves, contraseñas ni contenido sensible.
- No ignorar errores sin una decisión explícita.

## Git

Ramas sugeridas:

- `feature/job-assignments`
- `fix/session-refresh`
- `docs/security-model`

Commits sugeridos:

- `feat: add job assignment flow`
- `fix: enforce reviewer role in approval`
- `docs: document storage policies`

Cada commit debe representar una intención coherente y evitar cambios ajenos.

## Pull requests

Incluir:

- Problema y resultado.
- Principales decisiones.
- Cómo se verificó.
- Capturas para cambios visuales.
- Migraciones y riesgos.
- Pasos de despliegue especiales.

## Definición de terminado

- Requisito aceptado.
- Código legible y sin secretos.
- Lint y build correctos.
- Pruebas proporcionales al riesgo.
- Accesibilidad revisada.
- Seguridad verificada.
- Documentación actualizada.
