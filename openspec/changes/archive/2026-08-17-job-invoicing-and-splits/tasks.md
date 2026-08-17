# Tasks: Job Invoicing and Financial Splits

## Review Workload Forecast

- estimated_changed_lines: ~1,100
- review_budget_lines: Unlimited
- chained_prs_recommended: No; atomic deploy: DB + code ship together; intermediate states inconsistent; commit by work unit (migrations/lib/UI/dashboard) inside one PR.
- review_budget_risk: Low
- decision_needed_before_apply: No

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Enum labels migration

- [x] 1.1 Create `supabase/migrations/20260817010000_job_invoicing_enum_labels.sql`: `ALTER TYPE public.job_status ADD VALUE IF NOT EXISTS 'en_revision' AFTER 'asignado'` and `'facturado' AFTER 'aprobado'`; idempotent.

## Phase 2: Columns + data backfill migration

- [x] 2.1 Create `supabase/migrations/20260817011000_job_invoicing_columns_and_data.sql`: add nullable `jobs.invoice_number text`, `jobs.invoice_path text`, `jobs.invoiced_at timestamptz`.
- [x] 2.2 Same migration: DO-block backfill `en_progreso→asignado`, `enviado_revision→en_revision`, `listo_pagar→facturado`; log pre/post state counts.

## Phase 3: State machine + permissions + catalog + billing_state migration

- [x] 3.1 Create `supabase/migrations/20260817012000_job_state_machine_and_permissions.sql`: `CREATE OR REPLACE FUNCTION validate_job_update` — sin_asignar→asignado, asignado→en_revision, en_revision→aprobado, en_revision→asignado (reason), aprobado→facturado (requires `invoice_number`), facturado→pagado; set timestamps; reject `invoice_number` edits once `pagado`; technician only via delivery RPC.
- [x] 3.2 Same migration: flip production gates — `add_job_production`, confirm/regenerate RPCs, RLS (`job_production_codes`, `job_photos`, `storage.objects`, `job_pdf_drafts`, admin evidence) to `asignado`/`en_revision`; assign `en_revision` on submit.
- [x] 3.3 Same migration: billing_state `(aprobado,listo_pagar,pagado)`→`(aprobado,facturado,pagado)` in `get_my_weekly_production`, `get_production_report`, `get_my_weekly_financial_allocations`, `get_financial_allocation_report`.
- [x] 3.4 Same migration: `set_job_archived_v2` + `delete_archived_job` guard `is_admin`→`is_office_staff`; leave price/user RPCs admin-only.
- [x] 3.5 Same migration: `list_my_production_catalog` inner-joins caller's active rate only; `confirm_delivered_job_pdf_complete_before_capabilities` resolves rate via `price_category_id`+`production_code_rates`, drops legacy reads.

## Phase 4: Contractor price/rate backfill migration

- [x] 4.1 Create `supabase/migrations/20260817013000_backfill_price_categories_and_rates.sql`: backfill `profiles.price_category_id` from `technician_type` where NULL; seed missing `subcontractor`/`inhouse` rates from legacy columns for active items, `effective_from '2026-08-17'`; idempotent guards.

## Phase 5: Types, state, actions, queries

- [x] 5.1 `src/lib/jobs/types.ts`: JobStatus `sin_asignar|asignado|en_revision|aprobado|facturado|pagado`.
- [x] 5.2 `src/lib/jobs/state.ts`: mirror canTransition + invoice guards.
- [x] 5.3 `src/lib/jobs/actions.ts`: approve/invoice/paid transitions, `invoice_number` payload, invoice upload to private `project-files`; archive/delete via `requireSupervisor()`.
- [x] 5.4 `src/lib/jobs/queries.ts`: `getTechnicianJob` exposes `list_my_financial_allocations`; weekly RPCs pass `p_reference_date`.
- [x] 5.5 `src/lib/jobs/status-presentation.ts` + `src/components/ui/status-badge.tsx`: labels/colors for new states.
- [x] 5.6 `src/lib/storage/core.ts`: gate `.in("main_status", ["asignado","en_revision"])`.

## Phase 6: UI components

- [x] 6.1 `src/components/jobs/technician-actions.tsx`: remove "Iniciar" (asignado is execution).
- [x] 6.2 `src/components/jobs/office-job-actions.tsx`: aprobar → facturar (modal: invoice_number + optional file) → pagar.
- [x] 6.3 `src/components/jobs/pdf-code-editor.tsx`: per-participant estimated $ = Σ placements×quantity×caller unit_rate; server stays authoritative.
- [x] 6.4 `src/components/catalog-manager.tsx`: flag items without active rates.
- [x] 6.5 Update status labels/refs in `jobs/{timeline,job-documents}.tsx`, `technician/{job-progress,collapsible-timeline}.tsx`, `dashboard/{sidebar,quick-actions,pending-review}.tsx` (incl. `?status=` links).
- [x] 6.6 `app/trabajos/[id]/page.tsx` + `entregar/page.tsx`: gates asignado/en_revision; `canArchive`/`canDelete` supervisor; own amount.

## Phase 7: Dashboard week selector

- [x] 7.1 `src/components/dashboard-client.tsx` + `app/dashboard/page.tsx`: week selector → `p_reference_date` (replace `searchParams.ref`); pending visible from delivery.

## Phase 8: Verification

- [x] 8.1 VERIFY-ONLY invariants (no code change): technician rejected by `requireSupervisor()`; history append-only, one event, rejected → no event; invalid quantity rejected in `add_job_production`; own-job RLS; inactive supervisor rejected via `is_office_staff`.
- [ ] 8.2 Re-run migrations 1–4 (idempotent); verify DO-block counts. (Blocked in this environment: Supabase CLI not installed; migrations are written idempotent — re-run and DO-block counts to be verified in sdd-verify with a linked database.)
- [x] 8.3 `npm run lint` + `npm run build` pass.
- [ ] 8.4 Manual matrix: técnico (gate asignado/en_revision), supervisor (aprobar/facturar/pagar/archivar/eliminar), admin (tarifas), ayudante (monto). (Pending human/manual verification; documented for sdd-verify.)
