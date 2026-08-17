# Propuesta: Facturación de trabajos y reparto financiero

## Intención

Cerrar el ciclo de negocio de los trabajos: cambiar el pipeline de estados por `sin_asignar → asignado → en_revision → aprobado → facturado → pagado` (sin `en_progreso`, sin `listo_pagar`), agregar facturación real (número de factura + opción de archivar la factura), corregir los permisos de supervisor y reparar el cluster de dinero: técnicos contratistas que no pueden cargar códigos, visibilidad de listas de precio, y el reparto que no muestra montos ni llega a los participantes.

## Resumen del estado actual

- Enum `job_status`: `sin_asignar, asignado, en_progreso, enviado_revision, aprobado, listo_pagar, pagado` (`20260810001000`). Transiciones validadas en `validate_job_update` (SQL) y `canTransition` (`src/lib/jobs/state.ts`).
- Entrada de producción gateada por `main_status = 'en_progreso'` en `add_job_production` y en políticas RLS (`job_production_codes`, `job_photos`, `storage.objects`, `job_pdf_drafts`); la entrega edita `en_progreso`/`enviado_revision` (`20260814030000`).
- Precios: `production_code_catalog` conserva columnas legacy `in_house_rate`/`contractor_rate`; precios por categoría en `production_code_rates` + `profiles.price_category_id` (`20260813036000`). `confirm_delivered_job_pdf_complete_before_capabilities` todavía inserta líneas de entrega leyendo las columnas legacy (`20260814030000:306-310`, luego corregido por trigger).
- Reparto: `job_delivery_financial_allocations` (basis points + cents) vía `confirm_delivered_job_pdf_with_allocations` (`20260813040000`). La UI de reparto (`pdf-code-editor.tsx:438-462`) solo pide porcentajes.
- Permisos: archivar (`set_job_archived_v2`) y eliminar (`delete_archived_job`) exigen `is_admin`; el frontend lo refleja (`canArchive = role === "admin"`).

## Alcance

### En alcance

- Pipeline de estados nuevo; eliminar `en_progreso`; renombrar `enviado_revision → en_revision`; reemplazar `listo_pagar → facturado`; columna `invoice_number`; transición `aprobado → facturado` con captura de factura y opción "archivar con factura"; cierre `pagado`.
- Permisos de supervisor: archivar, eliminar archivados y toda operación de trabajos no relacionada con precios/usuarios.
- Fix contratistas: backfill de `price_category_id` y de `production_code_rates` para la categoría `subcontractor`.
- Visibilidad de listas de precio: el técnico solo ve códigos con tarifa de SU categoría.
- Reparto: montos en la UI de reparto, monto propio visible para cada participante, reparto visible para el ayudante, y asignaciones aprobadas visibles en la cuenta del técnico.

### Fuera de alcance

- Cambiar la lógica de pricing por categoría (ya existe); solo se repara la data y los filtros.
- Facturación electrónica/integraciones externas (QuickBooks, etc.).
- Modificar cierres históricos o migraciones ya aplicadas; solo migraciones nuevas.
- Cambiar permisos de supervisor sobre catálogo/tarifas o usuarios (siguen siendo admin-only).

## Capabilities

### Nuevas

- `job-invoicing`: estado `facturado`, captura de `invoice_number`, adjunto de factura al trabajo y cierre `pagado`.
- `financial-split-visibility`: monto por participante en la UI de reparto y visibilidad del reparto para cada participante (incluido ayudante) y en el dashboard del técnico.

### Modificadas

- `job-lifecycle`: reemplazo del enum y de la máquina de transiciones; nuevo gate de producción (`asignado`).
- `production-codes`: visibilidad de catálogo filtrada por categoría del técnico; fix de data para contratistas.
- `role-based-route-guard` / permisos de supervisor: archivar y eliminar trabajos deja de ser admin-only.

## Approach por área

### A. Pipeline de estados

- Migración nueva (aditiva, idempotente): `ALTER TYPE ... ADD VALUE` (`en_revision`, `facturado`); migrar data: `en_progreso → asignado`, `enviado_revision → en_revision`, `listo_pagar → facturado`; columna `jobs.invoice_number` (nullable hasta la transición) + `invoiced_at`.
- Eliminar labels viejos del enum en una SEGUNDA migración (recreación de tipo con casts), solo después de verificar en producción — Postgres no permite quitar valores de enum sin recrear el tipo.
- Actualizar `validate_job_update` y `canTransition`: `asignado→en_revision` (entrega), `en_revision→aprobado` / `en_revision→asignado` (devolución con motivo), `aprobado→facturado` (exige `invoice_number`), `facturado→pagado`. La entrega deja el job en `en_revision`.
- Gate de producción: `add_job_production`, RLS (`job_production_codes`, `job_photos`, `storage.objects`, `job_pdf_drafts`) y páginas (`entregar`, detalle) pasan a aceptar `asignado` (+ `en_revision` para correcciones, consistente con `20260814030000`). DECISIÓN EXPLÍCITA: `asignado` = "en progreso".
- `billing_state` 'confirmed' pasa de `(aprobado, listo_pagar, pagado)` a `(aprobado, facturado, pagado)` en `get_my_weekly_production`, `get_production_report`, `get_my_weekly_financial_allocations`, `get_financial_allocation_report` y funciones de dashboard.
- "Archivar con factura": documento de factura como `job_documents` (nuevo `document_type` 'invoice') o columna `invoice_url` en Storage privado (decisión en design).
- UI: `office-job-actions.tsx` (aprobar → facturar → pagar), `technician-actions.tsx` (iniciar = asignado), `job-progress`, `status-badge`, `status-presentation`, `timeline`, filtros y labels.

### B. Permisos de supervisor

- `set_job_archived_v2` y `delete_archived_job`: `is_admin` → `is_office_staff`.
- Política RLS `Admins can delete jobs` (jobs) → office staff; frontend `canArchive`/`delete` por rol.
- Precios y usuarios permanecen admin-only (sin cambios en `manage_production_catalog_item`, `set_production_catalog_rate`, `set_technician_price_category`, `list_profiles_for_office`).

### C. Contratistas no pueden cargar códigos (bug principal)

- Causa raíz verificada (ambas fallas vivas):
  1. `profiles.price_category_id` NULL en perfiles contractor creados después del backfill único de `20260813036000:102-111` → "Technician price category is not configured".
  2. Ítems de catálogo nuevos (vía `manage_production_catalog_item`) no generan filas en `production_code_rates` → "Production code has no configured rate for technician category". La categoría `wallace` tampoco tiene tarifas.
- Fix: migración de reparación — backfill `price_category_id` desde `technician_type` donde sea NULL; sembrar filas de `production_code_rates` faltantes para `subcontractor` (y `inhouse`) desde las columnas legacy para todo ítem activo; `manage_production_catalog_item` crea/avisa la falta de rates.

### D. Visibilidad de listas de precio

- Fuga identificada: `list_my_production_catalog` (`20260813036000:334-363`) devuelve TODOS los ítems activos del catálogo (la lista completa de ambas categorías) con la tarifa solo del llamador; el selector del editor PDF (`pdf-code-editor.tsx:417`) y `CodeInput` muestran ítems ajenos como "Sin tarifa configurada". La matriz de dos columnas (`/catalogo`, `catalog-manager.tsx`) es supervisor-only y es correcta.
- Fix: filtrar el RPC a ítems con tarifa activa de la categoría del llamador; eliminar lecturas legacy (`in_house_rate`/`contractor_rate`) de `confirm_delivered_job_pdf_complete_before_capabilities` usando solo categoría; a futuro, deprecar las columnas legacy.

### E. Reparto (cluster de dinero)

- Montos en la UI de reparto: calcular total estimado cliente-side (placements × cantidad × `unit_rate` del catálogo del llamador) y mostrar $ por participante al editar porcentajes; el servidor sigue siendo la fuente de verdad (cents exactos).
- Monto propio del técnico: exponer `list_my_financial_allocations` en el detalle del trabajo (hoy solo existe el dashboard) y asegurar el mapping de `billing_state` con `facturado`.
- Aprobados no aparecen: verificar ventana semanal por `d.confirmed_at` vs fecha de aprobación, filtros `submitted`/`current_delivery_id` y estados 'confirmed'; corregir estados y ventana.
- Ayudante no ve el reparto: `list_delivery_allocation_participants` y RLS de participantes ya lo incluyen; el problema es la misma visibilidad/ventana anterior más la ausencia de superficie por trabajo; se valida contra data real en design.

## Decisiones clave

1. `asignado` reemplaza a `en_progreso` como estado "en ejecución" para TODOS los gates de producción y edición.
2. El enum se migra en dos etapas (add+data → drop de labels) para permitir rollback real.
3. La factura adjunta vive en Storage privado ligada al trabajo; `invoice_number` es obligatorio al facturar.
4. El reparto muestra montos ESTIMADOS en UI y montos EXACTOS (cents) al confirmar, como hoy.
5. Supervisor gana todo lo de trabajos salvo precios y usuarios.

## Riesgos

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Drop de labels de enum rompe triggers/funciones dependientes | Alta | Migración en 2 etapas; regresión de SQL completa; verificación en staging |
| Data migrada inconsistente (jobs históricos en estados viejos) | Alta | Migraciones idempotentes con guards; reporte pre/post de conteos por estado |
| Gate nuevo de producción deja trabajos sin poder cargar códigos | Media | El gate acepta `asignado` y `en_revision`; prueba manual por rol |
| Backfill de rates genera precios incorrectos desde columnas legacy | Media | Backfill solo donde no exista fila de rate; revisión de diffs antes de aplicar |
| Supervisor con más permisos de lo acordado | Baja | El cambio toca solo jobs; precios/usuarios intactos; `is_admin` sigue en esos RPCs |
| Sin test runner | Alta | Lint + build + verificación manual por rol y transición (`openspec/config.yaml`) |

## Plan de rollback

1. Etapa 1 (add labels + data + permisos) es reversible: re-`ADD VALUE` de labels viejos, migración inversa de data (`facturado → listo_pagar`, `en_revision → enviado_revision`, `asignado → en_progreso` solo para los migrados), revocar permisos de supervisor vía migración nueva, y `git revert` del código.
2. Etapa 2 (drop de labels legacy) solo se ejecuta tras verificación en producción; su rollback es recrear el tipo con todos los labels (snapshot previo).
3. `invoice_number` es columna aditiva nullable; su rollback es un drop de columna.
4. Los backfills son idempotentes (guards) y re-ejecutables.

## Dependencias

- Guías de Next.js 16 en `node_modules/next/dist/docs/`; `openspec/config.yaml` (rules.proposal: rollback, docs).
- Docs de proyecto: `docs/00-PROYECTO.md`, `docs/01-ARQUITECTURA.md`, `docs/04-SEGURIDAD.md`.
- Storage privado para facturas (bucket existente `project-files` o nuevo).

## Criterios de éxito

- [ ] El pipeline es `sin_asignar → asignado → en_revision → aprobado → facturado → pagado`; `en_progreso` y `listo_pagar` no existen en código ni en UI.
- [ ] Facturar exige `invoice_number`; "archivar con factura" adjunta el documento; pagar cierra el trabajo.
- [ ] Supervisor aprueba, factura, marca pagado, archiva y elimina archivados; no puede tocar precios ni usuarios.
- [ ] Un técnico contratista con categoría y tarifas correctas carga códigos sin errores de categoría/tarifa.
- [ ] El técnico ve únicamente códigos con tarifa de su categoría.
- [ ] La UI de reparto muestra % y $ por participante; cada participante (incluido ayudante) ve su monto; aprobados aparecen en la cuenta del técnico.
- [ ] `npm run lint` y `npm run build` pasan; verificación manual por rol documentada.

## Preguntas abiertas

1. ¿`en_revision` sigue editable por el técnico (correcciones) como hoy, o solo `asignado`?
2. ¿`invoice_number` lleva unicidad/formato? ¿Quién puede corregirlo después de facturar?
3. ¿"Archivar con factura" es obligatorio para llegar a `pagado`, o solo al elegir la opción?
4. Montos estimados del reparto: ¿se calculan con la tarifa de la categoría del llamador o por categoría de cada participante?
5. Ventana semanal financiera: ¿por `confirmed_at` de entrega o por fecha de aprobación/facturación?
