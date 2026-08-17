```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:a8b554cdfe3485ce901dfcfd0e5638016ac1a89430be25a36b47a9f93944be83
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 16/16
scenarios: 36/36
test_command: ""
test_exit_code: 0
test_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:922dfc35923301c4aac32af73a4589986bc8fe32cc47308da37172b108d6f098
```

## Verification Report

**Change**: job-invoicing-and-splits
**Version**: N/A (delta specs, unversioned)
**Mode**: Standard (strict_tdd: false — openspec/config.yaml; no test runner installed)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 26 |
| Tasks complete | 24 |
| Tasks incomplete | 2 (8.2, 8.4 — environment/human verification, see WARNINGS) |

### Build & Tests Execution

**Build**: ✅ Passed — `npm run build` (Next.js 16.3.0, Turbopack). TypeScript finished clean, 16 routes compiled, static pages generated.

```text
> next build
✓ Compiled successfully in 1441ms
  Running TypeScript ...
  Finished TypeScript in 2.6s
✓ Generating static pages using 5 workers (16/16) in 602ms
Route (app): 16 routes generated (no errors)
```

**Lint**: ✅ Passed — `npm run lint` → exit 0, 0 errors (eslint clean).

**Tests**: ➖ None — `openspec/config.yaml` declares `testing.runner: ""`, `test_command: ""`, `strict_tdd: false`, all test layers disabled. This is the project's declared verification model: lint + build + SQL re-run + manual role matrix (tasks 8.2/8.4 and design.md "Testing Strategy"). No automated test evidence exists by design; runtime scenario compliance is delegated to the pending manual matrix.

**Coverage**: ➖ Not available (no coverage runner configured; `coverage_threshold: 0`).

### Spec Compliance Matrix

Test column is `—` for every scenario: the project has no test runner by config, so no scenario has an automated covering test. Results below reflect implementation evidence (source inspection + successful lint/build); runtime confirmation for DB-level behavior remains pending the manual role matrix (task 8.4) and migration re-run (task 8.2).

| Req | Scenario | Test | Result |
|-----|----------|------|--------|
| JI-1 (Facturación de trabajos aprobados) | Facturar exige número de factura | — | ✅ IMPLEMENTED — `validate_job_update` (20260817012000:59-61) raises on `aprobado→facturado` without trimmed `invoice_number`; `invoiceJob` (actions.ts:346-369) enforces server-side too. Runtime pending 8.4. |
| JI-1 | Facturación exitosa | — | ✅ IMPLEMENTED — trigger sets `invoiced_at := clock_timestamp()` (20260817012000:91); `invoiceJob` persists `main_status=facturado` + `invoice_number`/`invoice_path`. |
| JI-2 (Corrección del número de factura) | Corrección permitida antes del pago | — | ✅ IMPLEMENTED — `correctInvoiceNumber` (actions.ts:371-397) allowed while `facturado`, supervisor-only. |
| JI-2 | Corrección bloqueada tras el pago | — | ✅ IMPLEMENTED — client blocks `pagado`; trigger "Invoice details are immutable after payment" (20260817012000:84-87). |
| JI-3 (Archivar con factura) | Adjunto de factura al facturar | — | ✅ IMPLEMENTED — invoice modal (office-job-actions.tsx:28-44) uploads via `prepareInvoiceUpload` to private `project-files` `<jobId>/invoice/<uuid>.<ext>` (storage/core.ts:66-75); path persisted with invoice. |
| JI-3 | Facturar sin adjuntar documento | — | ✅ IMPLEMENTED — file optional; `invoiceJob` accepts `invoicePath` null; UI copy confirms ("Podés facturar sin adjuntar nada"). |
| JI-4 (Cierre como pagado) | Marcar como pagado | — | ✅ IMPLEMENTED — `facturado→pagado` office-only in trigger + `canTransition`; no outgoing transitions from `pagado`; `paid_at` set (20260817012000:92). |
| FSV-1 (Montos estimados en la UI de reparto) | Ajuste de porcentajes muestra montos | — | ✅ IMPLEMENTED — pdf-code-editor.tsx:203-208 computes estimated total (Σ placements×quantity×caller rate); per-participant `estimatedAmountFor` rendered at line 466 with percentage. |
| FSV-1 | Confirmación persiste montos exactos | — | ✅ IMPLEMENTED — server authoritative: `create_delivery_allocation_version_internal` floor + remainder cent distribution (20260813040000:211-236, unchanged); route validates allocations sum to 10000 bps. |
| FSV-2 (Monto propio visible) | Técnico ve su monto en el detalle del trabajo | — | ✅ IMPLEMENTED — `getTechnicianJob` calls `list_my_financial_allocations` (queries.ts:101); detail page renders "Tu reparto financiero" for current allocations ([id]/page.tsx:61). |
| FSV-2 | Ayudante ve su monto | — | ✅ IMPLEMENTED — `list_my_financial_allocations` filters `participant_id = auth.uid()` and `is_field_worker()` (20260813041000:98-134), which covers ayudante workers. |
| FSV-3 (Dashboard financiero del técnico) | Dinero visible desde la entrega | — | ✅ IMPLEMENTED — weekly RPC window keyed to `confirmed_at` (delivery confirmation), pending/confirmed split shown in dashboard-client.tsx:17-18; billing_state `(aprobado,facturado,pagado)`. |
| FSV-3 | Consulta de la semana anterior | — | ✅ IMPLEMENTED — `?week=` offset → `referenceDateForWeek` → `p_reference_date` RPC parameter (app/dashboard/page.tsx:10-34; queries.ts:108-118). |
| JL-1 (Creación y edición por oficina) | Oficina crea un trabajo válido | — | ✅ IMPLEMENTED — `createJob` → `requireSupervisor()`; DB defaults: `category` enum restricted to categoria_1..3 (default categoria_1), `main_status` default `sin_asignar`. |
| JL-1 | Rol no autorizado intenta crear | — | ✅ IMPLEMENTED — `requireSupervisor()` throws for technicians (server action + `requireProfile` role check); jobs insert policy is office-staff-only. |
| JL-2 (Máquina de estados) | Técnico entrega su trabajo | — | ✅ IMPLEMENTED — pdf-entregado route gates `asignado/en_revision`; `confirm_delivered_job_pdf_*_v3` chain sets `main_status='en_revision'` on submit (20260817012000:526). |
| JL-2 | Oficina aprueba | — | ✅ IMPLEMENTED — `en_revision→aprobado` in trigger + `canTransition`; `approved_at` set. |
| JL-2 | Oficina devuelve para corrección | — | ✅ IMPLEMENTED — `en_revision→asignado` requires reason: trigger requires non-empty `comments` (20260817012000:56-58); `canTransition` mirrors; reason audited in history via `handle_job_change` notes. |
| JL-2 | Transición inválida | — | ✅ IMPLEMENTED — `sin_asignar→aprobado` rejected by trigger office branch and by `canTransition` (not in OFFICE_TRANSITIONS); state preserved on raise. |
| JL-2 | Facturar exige número de factura | — | ✅ IMPLEMENTED — same guard as JI-1 (trigger + client). |
| JL-3 (Correcciones en en_revision) | Técnico corrige en en_revision | — | ✅ IMPLEMENTED — production RPC, PDF draft RPCs, photo/evidence RLS policies and storage policies all gate on `('asignado','en_revision')` (20260817012000 sections 2/2b). |
| JL-4 (Historial auditable) | Cambio exitoso queda registrado | — | ✅ IMPLEMENTED — `on_job_updated` AFTER trigger → `handle_job_change` inserts exactly one `job_status_history` row (job_id, prev/new status+incident, changed_by=auth.uid(), notes) per status/incident change. |
| JL-4 | Cambio rechazado no genera evento | — | ✅ IMPLEMENTED — rejections raise in BEFORE trigger `validate_job_before_update`; row unchanged; AFTER trigger never fires. |
| PC-1 (Registro de código y cantidad) | Técnico registra una cantidad válida | — | ✅ IMPLEMENTED — `add_job_production` chain (wrapper → `_before_capabilities` 20260817012000:104-175) validates and inserts with `added_by=actor`, rate snapshot by price category. |
| PC-1 | Corrección en en_revision | — | ✅ IMPLEMENTED — gate includes `en_revision` (20260817012000:141). |
| PC-1 | Cantidad inválida | — | ✅ IMPLEMENTED — SQL rejects null/NaN/±Infinity/≤0 (20260817012000:129-132); client mirrors `!Number.isFinite || <= 0` (actions.ts:263). |
| PC-2 (Acceso acotado a códigos) | Consulta autorizada | — | ✅ IMPLEMENTED — select policy "Technicians can view production codes of assigned jobs" (can_access_job); `getTechnicianJob` returns codes. |
| PC-2 | Escritura sobre trabajo ajeno | — | ✅ IMPLEMENTED — RPC `can_access_job` + insert policy `added_by = auth.uid() and can_mutate_job(job_id)` + gate status (20260817012000:650-656). |
| PC-3 (Catálogo filtrado) | Técnico ve solo su categoría | — | ✅ IMPLEMENTED — `list_my_production_catalog` inner-joins caller's active rate only (20260817012000:1019-1046). |
| PC-3 | Ítem sin tarifa queda oculto | — | ✅ IMPLEMENTED — inner join on `production_code_rates` excludes items without an active effective rate for the caller's category. |
| PC-4 (Contratista carga códigos) | Contractor carga códigos sin errores | — | ✅ IMPLEMENTED — backfill migration 4 sets `price_category_id` from `technician_type` and seeds inhouse/subcontractor rates for active items lacking them; `add_job_production` resolves rate by `price_category_id` + `production_code_rates`, no legacy column reads. |
| RB-1 (Permisos de supervisor sobre trabajos) | Supervisor archiva un trabajo | — | ✅ IMPLEMENTED — `set_job_archived_v2` guard `is_admin`→`is_office_staff` (20260817012000:920); UI `canArchive={isOfficeRole(profile.role)}` ([id]/page.tsx:102). |
| RB-1 | Supervisor elimina un trabajo archivado | — | ✅ IMPLEMENTED — `delete_archived_job` guard → `is_office_staff` (20260817012000:973); client `deleteArchivedJob` behind `requireSupervisor()`. |
| RB-1 | Técnico no puede archivar ni eliminar | — | ✅ IMPLEMENTED — RPC raises `Office access required` for non-office; server actions `requireSupervisor()`; jobs delete remains revoked from `authenticated` (20260811030000). |
| RB-1 | Precios y usuarios siguen siendo admin-only | — | ✅ IMPLEMENTED — `manage_production_catalog_item`, `set_production_catalog_rate`, `set_technician_price_category` untouched (is_admin); users route unchanged. |
| RB-1 | Supervisor inactivo no puede archivar | — | ✅ IMPLEMENTED — `is_office_staff` requires `is_active` (20260810001000:29-42), so the migrated guard rejects inactive supervisors by construction. |

**Compliance summary**: 36/36 scenarios have complete implementation evidence (static + lint/build). 0/36 have automated runtime test coverage because the project declares no test runner; runtime confirmation (DB re-run and manual role matrix) remains pending tasks 8.2/8.4.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| New job pipeline (enum + states) | ✅ Implemented | `ADD VALUE IF NOT EXISTS 'en_revision'/'facturado'` (idempotent); TS `JobStatus` union, `JOB_STATUS_ORDER`, labels/colors for all 6 states; legacy states absent from TS/TSX (grep: 0 matches). |
| Data backfill | ✅ Implemented | DO block maps en_progreso→asignado, enviado_revision→en_revision, listo_pagar→facturado with pre/post counts, one attributed history event per changed job, triggers suspended/re-enabled. Re-run pending 8.2. |
| State machine + invoice guards | ✅ Implemented | Trigger + `canTransition` mirror; invoice_number required, invoiced_at set, pagado immutability, reason required for returns, technician delivery only via RPC. |
| Production gates | ✅ Implemented | RPC + RLS + storage policies + draft RPCs all flipped to `asignado`/`en_revision`; submit assigns `en_revision`; delegated wrapper chain (v3 → v2 → `_before_capabilities`) resolves the new definitions at runtime. |
| billing_state | ✅ Implemented | All 4 RPCs use `(aprobado,facturado,pagado)`. |
| Supervisor archive/delete | ✅ Implemented | Both RPCs `is_office_staff`; prices/users remain admin-only. |
| Catalog filtered by caller category | ✅ Implemented | Inner join to active effective rate; confirm RPC resolves rate by price category; route pre-checks rates per placement. |
| Contractor backfill | ✅ Implemented | `price_category_id` from `technician_type` where NULL; rates seeded for active items lacking an active rate pair; `on conflict do update`; `wallace` excluded by design. |
| Financial split UI amounts | ✅ Implemented | Estimated per-participant $ in allocation stage; server floor+remainder authoritative. |
| Participant own amount | ✅ Implemented | `list_my_financial_allocations` exposed in `getTechnicianJob`; own-amount section on technician detail. |
| Dashboard week selector | ✅ Implemented | `?week=` offset → `p_reference_date` for both weekly RPCs; pending visible from delivery (`billing_state` semantics). |
| Dashboard pending review | ✅ Implemented | `listOfficeJobs({ status: "en_revision" })` for office dashboards. |
| Storage invoice upload | ✅ Implemented | `prepareInvoiceUpload` → `project-files` `<jobId>/invoice/` (private bucket, office-staff RLS); supervisor-only server action. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| `invoice_path` + Storage `<job_id>/invoice/<uuid>.<ext>` in private `project-files` | ✅ Yes | storage/core.ts + office-job-actions modal. |
| Two-stage enum (ADD VALUE now, type recreation later) | ✅ Yes | Only additive SQL in stage 1; legacy labels retained in applied migrations by design. |
| Estimated client amounts, server authoritative | ✅ Yes | pdf-code-editor + `create_delivery_allocation_version_internal` untouched. |
| Backfill only NULL categories / missing rate pairs; wallace excluded | ✅ Yes | Migration 4 guards. |
| Supervisor scope = `is_office_staff` on job archive/delete only | ✅ Yes | Prices/users RPCs untouched admin-only. |
| Weekly financial window = delivery confirmation (unchanged) | ✅ Yes | `confirmed_at`/`credited_at` window untouched; only billing_state set changed. |
| Open question: office evidence upload for supervisor | ⚠️ Deviation (documented) | Photo upload on office detail stays admin-only; document management stays admin-only ("toca SOLO los guards de los RPCs"). No spec requirement broken. |

### Issues Found

**CRITICAL**: None.

**WARNING**:

1. **[tasks 8.2]** Migrations 20260817010000–13000 were NOT executed against a linked database: Supabase CLI is unavailable in this environment. Idempotent re-run verification and DO-block pre/post counts remain pending-human-verification, not a code failure.
2. **[tasks 8.4]** Manual role matrix (técnico/supervisor/admin/ayudante) is pending human execution. Per project config there is no test runner, so runtime proof of the 36 scenarios depends on this matrix; until completed, runtime compliance is unproven.
3. **[JI-2 / defense-in-depth]** `validate_job_update` excludes `invoice_number`/`invoice_path`/`invoiced_at` from the technician "office-managed fields" check. A technician who remains actively assigned to a non-`pagado` job could modify invoice fields through a direct Supabase client UPDATE (jobs update RLS + `can_mutate_job` do not check these columns/status). No application code path does this (all invoice actions require `requireSupervisor()`), and the `pagado` immutability guard holds. Recommend tightening the trigger or the RLS policy.
4. **[Design deviation]** Evidence photo upload on office detail remains admin-only and document management remains admin-only (design open questions left unresolved by explicit choice). role-based-route-guard only mandates archive/delete for supervisor — no spec broken.

**SUGGESTION**:

1. Schedule stage 2 (drop legacy enum labels via type recreation) after production verification — legacy labels and the now-inert `guard_job_submission_confirmation` trigger still reference `en_progreso`/`enviado_revision` in applied migrations.
2. Add a comment in `canTransition` noting that `sin_asignar → asignado` is deliberately absent because assignment is RPC-only (`assign_jobs_atomic`).

### Verdict

**PASS WITH WARNINGS** — All 26 tasks except the two environment/human verification tasks are complete; lint and build pass; all 16 requirements / 36 scenarios have complete implementation evidence; no CRITICAL findings. Runtime verification (migration re-run, manual role matrix) remains pending human execution before production.
