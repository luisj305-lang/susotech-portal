# Design: Facturación de trabajos y reparto financiero

## Technical Approach

Cambio aditivo en dos etapas: (1) enum nuevo + backfill + máquina de estados + permisos, (2) drop de labels legacy diferido a post-verificación en producción. Una sola fuente de verdad de transiciones (trigger `validate_job_update` + espejo `canTransition`), gate de producción flipeado de `en_progreso` a `asignado` (+ `en_revision`), reparto con montos estimados en UI y centavos exactos en servidor. Sin test runner: lint + build + matriz manual por rol.

## Architecture Decisions

| Decisión | Opciones / tradeoffs | Elección |
|---|---|---|
| Adjunto de factura | `job_documents` con `document_type 'invoice'` (fuerza position/verification y flujos de borrado) vs `jobs.invoice_path text` + Storage | `jobs.invoice_path` + `<job_id>/invoice/<uuid>.<ext>` en bucket privado `project-files`. RLS office-staff ya cubre lectura/escritura y `delete_archived_job` ya barre `project-files` con prefijo `<job_id>/` |
| Enum | Drop directo de labels (rompe triggers) vs dos etapas | Dos etapas: `ADD VALUE IF NOT EXISTS` (idempotente, evita el pitfall de PG de usar valores nuevos en la misma transacción) y recreación de tipo solo en etapa 2 |
| Montos del reparto | Cliente calcula y persiste vs estimado en UI | Estimado cliente = Σ placements × quantity × `unit_rate` de la categoría del actor; servidor autoritativo (`create_delivery_allocation_version`, floor + remainder de centavos) |
| Backfill contractor | Reescribir history vs sembrar solo faltantes | Solo donde `price_category_id` es NULL y solo pares (item, categoría) sin rate activo; `wallace` queda para `set_production_catalog_rate` (sin fuente legacy) |
| Permisos supervisor | `is_admin` granular por RPC | `is_office_staff` solo en jobs (`set_job_archived_v2`, `delete_archived_job`, UI); precios/usuarios intactos admin-only |

## Data Flow

```
técnico entrega (confirm RPC, p_submit) ──▶ en_revision + job_delivery_production_lines + allocations
                                                    │
supervisor: aprobado ──▶ facturado (invoice_number + adjunto opcional) ──▶ pagado
                                                    │
billing_state (dashboards) ◀── jobs.main_status ∈ (aprobado, facturado, pagado)
```

## State Machine (validate_job_update / canTransition)

| De | A | Actor | Requisito | Timestamp |
|---|---|---|---|---|
| sin_asignar | asignado | oficina | asignación | — |
| asignado | en_revision | técnico (RPC entrega) u oficina | p_submit confirmado | submitted_at |
| en_revision | aprobado | oficina | — | approved_at |
| en_revision | asignado | oficina | motivo en comments | — |
| aprobado | facturado | oficina | `invoice_number` no vacío | invoiced_at |
| facturado | pagado | oficina | — | paid_at |
| * | * | técnico | solo incidentes; estado solo vía RPC entrega | — |

Guards trigger: `invoice_number` editable solo si no `pagado`; técnico nunca aprueba.

**Semántica de `invoice_number`** (spec `job-invoicing`): texto libre, SIN unicidad estricta; corregible solo por oficina (admin/supervisor activo) mientras `main_status <> 'pagado'`; tras `pagado` toda corrección se rechaza.

**Trazabilidad de timestamps**: `submitted_at`, `approved_at` y `paid_at` son columnas YA EXISTENTES de `jobs` (`20260810001000_jobs_module.sql:90-92`, seteadas por `validate_job_update`). La ÚNICA columna de timestamp NUEVA es `invoiced_at` (`20260817011000`). La tabla de arriba no introduce más columnas.

## Creación y edición de trabajos (sin cambios)

Comportamiento existente preservado (spec `job-lifecycle`; sin diseño nuevo, las tareas no deben tocar esta superficie — solo verificar que las migraciones nuevas no la rompan):

- `createJob` / `updateJob` (`src/lib/jobs/actions.ts:156,169`) exigen `requireSupervisor()`; un `tecnico` NO puede crear ni editar trabajos (rechazado en servidor).
- `category` restringida a `categoria_1|categoria_2|categoria_3` con default `categoria_1` (`20260810001000:80`); `main_status` inicial default `sin_asignar` (cambiado en `20260813034000:4`).

## Historial auditable (sin cambios)

Invariante existente preservado: `job_status_history` es append-only (insert/update/delete revocados a `authenticated`, `20260813031000:442-443`). El trigger AFTER UPDATE `on_job_updated` → `handle_job_change` (`20260810001000:564-566`) escribe EXACTAMENTE un evento (job_id, previous/new status+incident, changed_by=auth.uid(), notes) cuando cambia estado o incidente. Una transición rechazada levanta excepción en el BEFORE trigger (`validate_job_before_update`) → la fila del job NO se modifica y NO se genera evento de historial. Las transiciones nuevas (`en_revision`, `facturado`) reusan este mecanismo intacto.

## Ventana financiera semanal (confirmada, sin cambios)

La ventana semanal está clavada a la CONFIRMACIÓN de la entrega, no a aprobación ni facturación:

- `get_my_weekly_financial_allocations` (`20260813041000:156`) filtra por `(d.confirmed_at …)::date between w.starts and w.starts+6` (línea 186).
- `get_my_weekly_production` (`20260813031000:263`) filtra por `l.credited_at` (líneas 292-293), seteado por el RPC de confirmación al mismo `event_time` que `confirmed_at` (`20260814030000:310,328`) — mismo instante, sin fecha de aprobación/factura en la ventana.
- "Semana anterior" = shift de `p_reference_date` (parámetro ya presente en AMBAS firmas RPC): `coalesce(p_reference_date, hoy)` desplaza `w.starts` 7 días atrás.
- Lo único que cambia en estos RPCs es el set `billing_state` (`listo_pagar` → `facturado`).

## RPCs canónicos y RLS ya retirada (consistencia)

- Archivar: el RPC canónico es `set_job_archived_v2` (`20260813031000:75`); `set_job_archived` está SUPERSEDIDO (exec revocado a `authenticated` en `20260813032000:9`). El spec `role-based-route-guard` cita el nombre legacy; las tareas implementan contra `set_job_archived_v2` exclusivamente.
- Delete: la política RLS "Admins can delete jobs" YA ESTÁ RETIRADA (`drop policy` en `20260811030000:26`); la eliminación es RPC-only (`delete_archived_job`, `20260811030000:29`; fix de conflicto `20260811040000:5`). El cambio de permisos de supervisor toca SOLO los guards de los RPCs (`is_admin` → `is_office_staff`), no existen políticas de delete que tocar.
- `is_office_staff` exige `is_active` (`20260810001000:29-42`) → el requisito "supervisor inactivo no puede archivar" (spec `role-based-route-guard`) se cumple por construcción al migrar `set_job_archived_v2`/`delete_archived_job` a `is_office_staff`.

## Invariantes preservados (sin cambios, sin diseño nuevo)

- `production-codes`: la validación de cantidad inválida (NaN/Infinity/≤0) ya vive en `add_job_production` (`20260813036000:517-520`) — se preserva tal cual.
- RLS "técnico escribe solo su trabajo asignado": `added_by = auth.uid() and can_mutate_job(job_id)` en la policy de insert de `job_production_codes` (`20260813038000:196-201`) — se preserva; solo cambia el estado del gate (`en_progreso` → `asignado`/`en_revision`).
- "Supervisor inactivo no puede archivar": cubierto por `is_office_staff` (sección anterior).

## File Changes

| Archivo | Acción | Descripción |
|---|---|---|
| `supabase/migrations/20260817010000_job_invoicing_enum_labels.sql` | Create | `ADD VALUE IF NOT EXISTS 'en_revision' AFTER 'asignado'`, `'facturado' AFTER 'aprobado'` |
| `supabase/migrations/20260817011000_job_invoicing_columns_and_data.sql` | Create | Backfill `en_progreso→asignado`, `enviado_revision→en_revision`, `listo_pagar→facturado`; `jobs.invoice_number text`, `jobs.invoiced_at timestamptz`; DO block pre/post con conteos por estado |
| `supabase/migrations/20260817012000_job_state_machine_and_permissions.sql` | Create | `validate_job_update` nuevo + guards factura; flips de gate y billing_state; `set_job_archived_v2`/`delete_archived_job` → `is_office_staff`; `list_my_production_catalog` inner-join al rate |
| `supabase/migrations/20260817013000_backfill_price_categories_and_rates.sql` | Create | Backfill `price_category_id` desde `technician_type`; sembrar rates `inhouse`/`subcontractor` desde columnas legacy para ítems activos sin rate |
| `src/lib/jobs/{types,state,actions,queries,status-presentation}.ts`, `src/lib/storage/core.ts` | Modify | `JobStatus` union, orden, `canTransition`, payload `invoice_number`/`invoicePath`, `requireSupervisor` en archivar/eliminar, RPCs semanales con `p_reference_date`, labels |
| `src/components/jobs/{technician-actions,office-job-actions,pdf-code-editor}.tsx` | Modify | Iniciar desaparece (asignado ya es ejecución); aprobar→facturar→pagar con modal de factura; montos estimados por participante en allocation stage |
| `src/components/dashboard-client.tsx`, `app/dashboard/page.tsx` | Modify | Selector de semana (`searchParams.ref` → `p_reference_date`); pendiente visible desde la entrega |
| `app/trabajos/[id]/page.tsx`, `app/trabajos/[id]/entregar/page.tsx` | Modify | Gates `asignado`+`en_revision`; `list_my_financial_allocations` por trabajo; `canArchive`/`canDelete` supervisor |

## Gate de producción (en_progreso → asignado/en_revision)

- RPC `add_job_production` (`20260813036000:529`) y RLS `job_production_codes` (`20260813038000:200`), `job_photos` (`20260814030000:354`), `storage.objects` evidence (`20260814030000:368,383,390`), drafts (`:24,87`), confirm predicates (`:214,216`) + assign `en_revision` en submit.
- Lecturas de auditoría `20260813012000:99` y `20260813030000:105`; UI `entregar/page.tsx:17`, `[id]/page.tsx:60,102`, `storage/core.ts:32`.

## billing_state / Supervisor / Catálogo

- `(aprobado,listo_pagar,pagado)` → `(aprobado,facturado,pagado)` en `get_my_weekly_production` (`20260813031000:289`), `get_production_report` (`:336`), `get_my_weekly_financial_allocations` (`20260813041000:177`), `get_financial_allocation_report` (`:212`).
- Política "Admins can delete jobs" ya está retirada (`20260811030000`); delete es solo-RPC. Admin-only sin tocar: `manage_production_catalog_item`, `set_production_catalog_rate`, `set_technician_price_category`.
- `list_my_production_catalog` filtra por rate activo del llamador; `confirm_delivered_job_pdf_complete_before_capabilities` (`20260814030000:306-309`) resuelve rate por `price_category_id` + `production_code_rates` (como `add_job_production`), elimina lecturas legacy. `manage_production_catalog_item` conserva firma; `catalog-manager.tsx` marca ítems sin rates activos.
- Ayudante ve su monto: `list_my_financial_allocations` es por `auth.uid()` participante — exponer en `getTechnicianJob` lo cubre sin RLS nuevo.

## Testing Strategy

| Capa | Qué | Cómo |
|---|---|---|
| SQL | Transiciones, guards, backfills | Re-ejecución idempotente; DO blocks pre/post con conteos |
| Build | Tipos y labels | `npm run lint` + `npm run build` |
| Manual | Matriz por rol × transición × gate | Checklist en tareas: técnico (asignado/en_revision), supervisor (aprobar/facturar/pagar/archivar/eliminar), admin (tarifas), ayudante (monto) |

## Threat Matrix

N/A — sin routing, shell, subprocesos, automatización VCS/PR ni integración de procesos.

## Migration / Rollout

Etapa 1 (este change) reversible: re-`ADD VALUE` de labels viejos + backfill inverso + `git revert`. Etapa 2 (`drop` de `en_progreso`/`enviado_revision`/`listo_pagar` por recreación de tipo) solo post-verificación en producción, con snapshot previo. `invoice_number`/`invoice_path` son columnas aditivas nullable.

**Merge-safe / orden de archivo**: este change no modifica migraciones aplicadas ni specs ya archivados. Al archivar: crear primero los 4 main specs nuevos (`job-invoicing`, `financial-split-visibility`, `job-lifecycle`, `production-codes`); aplicar ÚLTIMO el delta `role-based-route-guard` contra su main spec existente. `jobs-module` nunca se archivó → ningún delta lo referencia; sin conflicto.

## Open Questions

- [ ] ¿Fecha `effective_from` de los rates sembrados? Propuesta: `2026-08-17` (día de despliegue).
- [ ] ¿Supervisor gestiona adjuntos/evidencias en UI (`canManage`/`canDelete`)? Propuesta: sí, coherente con "todo lo de trabajos".
- [ ] Criterio de verificación en producción que habilita la etapa 2 (drop de labels).
