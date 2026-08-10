# Proposal: Módulo de Trabajos

## Intent

Permitir que la oficina cree, asigne, supervise y cierre trabajos, y que los técnicos ejecuten los trabajos asignados desde el móvil con una interfaz rápida, accesible y preparada para baja conectividad.

## Scope

### In Scope

- Esquema `jobs`, `crews`, `crew_members`, `job_assignments`, `job_status_history`, `job_production_codes`, `job_photos`.
- Campo `category` de tipo enum con 3 etiquetas fijas: `categoria_1`, `categoria_2`, `categoria_3`.
- Estados principales: `asignado`, `en_progreso`, `enviado_revision`, `aprobado`, `listo_pagar`, `pagado`.
- Incidencias/bloqueos: `need_splicing`, `no_access`, `need_cr`, `permit_pending`, `returned`, `incomplete`.
- Asignación a técnico individual o a crew con responsable principal.
- Panel de oficina (`/trabajos`) para admin/supervisor: listado, filtros, creación, asignación, edición.
- Vista móvil del técnico (`/trabajos` y `/trabajos/[id]`): lista de trabajos asignados, detalle, cambio de estado, códigos de producción, fotos, comentarios, envío a revisión.
- Migraciones de base de datos y políticas RLS.
- Soporte para subida de archivos a Storage (PDF de proyecto, imágenes de evidencia).

### Out of Scope

- Marcadores sobre PDF (Fase 2.0 / Versión 2.0 del roadmap).
- Integraciones externas (QuickBooks, GPS, SMS).
- Importación masiva desde Excel/CSV (la importación masiva de PDFs sí está en scope).
- Notificaciones push.
- Dashboard financiero o analítica avanzada.

## Capabilities

### New Capabilities

- `job-lifecycle`: Crear, asignar y hacer transicionar trabajos por el flujo de estados.
- `crew-management`: Crear crews con responsable y miembros.
- `technician-field-view`: Vista móvil para técnicos con trabajos asignados.
- `production-codes`: Registrar códigos de producción por trabajo.
- `job-evidence`: Subir fotos y documentos a Storage vinculados a un trabajo.
- `incident-tracking`: Registrar incidencias sin perder el estado principal.
- `bulk-pdf-import`: Previsualizar, editar, deduplicar y subir directamente a Storage lotes de 50–100 PDF, creando un trabajo auditable por archivo confirmado sin transportar bytes mediante Server Actions.
- `bulk-assignment`: Asignar trabajos a técnico o crew de forma individual o en bloque.

### Modified Capabilities

- `role-based-route-guard`: Se extiende para proteger rutas de oficina (`/trabajos` gestión) y rutas de campo (`/trabajos` técnico).
- `profile-rls-hardening`: Se extiende con políticas RLS para jobs y asignaciones.

## Approach

1. Diseñar el esquema relacional con estados principales e incidencias separadas.
2. Crear migraciones SQL con enums, tablas, triggers para historial y RLS.
3. Construir server actions para operaciones de jobs (solo admin/supervisor crea/asigna; técnico actualiza progreso).
4. Crear páginas de oficina (`/trabajos`, `/trabajos/[id]`, `/trabajos/nuevo`, `/trabajos/importar`) orientadas a desktop.
5. Implementar importación masiva de PDFs en `/trabajos/importar` con autorización/confirmación metadata-only, carga directa navegador → Storage, reanudación y asignación individual o agrupada.
6. Crear páginas de técnico (`/trabajos`, `/trabajos/[id]`) orientadas a móvil: botones grandes, tarjetas, carga optimista.
7. Integrar Storage para PDF del proyecto y fotos de evidencia.
8. Verificar con escenarios por rol y transiciones de estado.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/migrations/` | New | Migraciones para jobs, crews, assignments, history, codes, photos. |
| `src/lib/jobs/actions.ts` | New | Server actions para CRUD y transiciones de jobs. |
| `src/lib/jobs/types.ts` | New | Tipos y enums de dominio. |
| `app/trabajos/page.tsx` | New | Listado de trabajos (vista adaptativa: oficina/técnico). |
| `app/trabajos/[id]/page.tsx` | New | Detalle y edición de trabajo. |
| `app/trabajos/nuevo/page.tsx` | New | Formulario de creación (admin/supervisor). |
| `app/trabajos/importar/page.tsx` | New | Importación masiva de PDFs y asignación en bloque. |
| `src/components/jobs/` | New | Componentes de tarjetas, formularios, timelines, botones de estado, importación masiva y asignación en bloque. |
| `src/lib/auth/session.ts` | Modify | Añadir `requireSupervisor()` o extender guards para oficina. |
| `src/lib/supabase/service.ts` | Modify | Usado para operaciones de Storage si es necesario. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Estados complejos generan transiciones inválidas. | Med | Máquina de estados explícita en server actions; historial de cambios. |
| Asignaciones a crew generan inconsistencias. | Med | FK con restricciones y validación de tipo de asignado. |
| Subida de archivos falla en móvil con mala señal. | High | Uploads a Storage con reintentos; estructura que permita reintentar. |
| PDF reales superan el límite de Server Actions. | High | Las Server Actions MUST transportar solo metadatos; los bytes van directamente del navegador a Storage mediante URL firmada. |
| Técnico ve trabajos no asignados. | Med | RLS estricta por asignación; pruebas negativas. |
| Sin runner de pruebas. | High | Verificación manual por rol y lint/build. |

## Rollback Plan

1. Revertir archivos modificados con `git checkout`.
2. Eliminar rutas `app/trabajos/` y `src/components/jobs/`.
3. Revertir migraciones de jobs en Supabase en orden inverso.

## Dependencies

- `auth-foundation-hardening` completado (roles, RLS, usuarios).
- Guías de Next.js 16 en `node_modules/next/dist/docs/`.
- Buckets de Storage en Supabase para proyectos y evidencias.

## Success Criteria

- [ ] Admin/supervisor pueden crear, asignar y editar trabajos.
- [ ] Admin/supervisor pueden previsualizar y editar cientos de PDF, importarlos con progreso/fallos aislados y asignarlos individual o masivamente.
- [ ] El PDF real de aproximadamente 4 MB se carga directamente a Storage; ningún Server Action recibe `File`, `Blob`, `FormData` ni bytes de PDF.
- [ ] Técnico solo ve trabajos asignados a él o a su crew.
- [ ] Estados principales e incidencias se guardan separadamente.
- [ ] Técnico puede cambiar estado, agregar códigos, fotos y comentarios.
- [ ] Transiciones de estado inválidas son rechazadas en el servidor.
- [ ] `npm run lint` y `npm run build` pasan.
