# 07 — Guía de desarrollo

## Requisitos locales

- Git.
- Node.js compatible con Next.js 16; Node 20 o superior recomendado.
- npm.
- Visual Studio Code.
- Acceso autorizado al proyecto de Supabase de desarrollo.

## Instalación

```powershell
git clone <url-del-repositorio>
Set-Location susotech-portal
npm install
Copy-Item .env.example .env.local
npm run dev
```

El repositorio debe incorporar `.env.example` sin valores secretos cuando se estabilice la configuración.

## Variables

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

No copiar secretos a documentación, tickets, capturas ni commits.

## Comandos

| Comando | Propósito |
|---|---|
| `npm run dev` | Servidor local. |
| `npm run lint` | Revisión estática. |
| `npm run build` | Compilación de producción. |
| `npm run start` | Ejecutar la compilación. |

## Flujo diario

1. Actualizar la rama base sin perder cambios locales.
2. Crear una rama enfocada.
3. Leer el documento relevante y `AGENTS.md`.
4. Implementar el cambio más pequeño que complete la historia.
5. Ejecutar lint y pruebas relacionadas.
6. Probar el flujo en navegador y el rol afectado.
7. Revisar el diff completo.
8. Actualizar documentación y migraciones.
9. Crear commits descriptivos.
10. Abrir revisión con resumen, pruebas y riesgos.

## Trabajo con Next.js

La versión instalada contiene cambios respecto a patrones históricos. Antes de usar una API de framework, consultar la guía correspondiente en `node_modules/next/dist/docs/`. Respetar advertencias de deprecación.

## Trabajo con Supabase

- Usar el cliente correcto para navegador o servidor.
- No usar `service_role` para evitar diseñar RLS.
- Crear migración para cambios de esquema.
- Probar consultas como diferentes roles.
- Verificar que los errores de autorización sean esperados y claros.

## Migraciones

Flujo recomendado:

1. Diseñar tablas, restricciones y permisos.
2. Crear una migración nueva.
3. Aplicarla en entorno local o de desarrollo.
4. Probar datos existentes y casos de acceso.
5. Revisar el SQL.
6. Aplicarla al ambiente compartido mediante el proceso acordado.

Nunca modificar silenciosamente una migración ya aplicada.

## Depuración

- Reproducir con pasos mínimos.
- Identificar si el fallo es UI, sesión, consulta, RLS o datos.
- Revisar el error sin exponer credenciales.
- Probar con el mismo rol y estado del registro.
- Corregir la causa, no solo el síntoma.
- Añadir una prueba de regresión cuando sea viable.

## Antes de entregar

```powershell
npm run lint
npm run build
git diff --check
git status --short
```

Además:

- Probar móvil y escritorio si cambió UI.
- Probar acceso permitido y denegado si cambió seguridad.
- Confirmar que no se incluyeron `.env`, `.next` ni archivos temporales.
- Actualizar el checklist y changelog cuando corresponda.

## Revisión de código

Una revisión debe comprobar corrección, seguridad, claridad, pruebas, migraciones, accesibilidad e impacto operativo. Los comentarios deben explicar riesgo y resultado esperado, no solo preferencia de estilo.
