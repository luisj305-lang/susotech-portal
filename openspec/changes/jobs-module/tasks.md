# Tasks: Módulo de Trabajos

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Existing change 800–1200; Phase 14 adds ~450–650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Existing units → 14A (directory/domain) → 14B (crew UI/routes) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |
| Corrective unit | Phases 13–14 use the authorized `stacked-to-main` strategy; no size exception. |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Test command | Runtime harness | Rollback boundary |
|------|------|----|--------------|-----------------|-------------------|
| 1 | Schema, enums, RLS, crews, assignments | PR 1 | `npm run lint && npm run build` | Manual: verify migrations apply; test RLS per role | Revert migration files and Supabase migrations |
| 2 | Office UI: list, create, import PDFs, bulk/individual assign, approve, pay | PR 2 | `npm run lint && npm run build` | Manual: admin/supervisor flow incluyendo importación masiva | Revert `app/trabajos/*`, `src/components/jobs/*` |
| 3 | Technician mobile UI: cards, status, incidents, codes, photos | PR 3 | `npm run lint && npm run build` | Manual: technician flow on mobile viewport | Revert technician-specific components and pages |
| 14A | Limited technician directory and crew mutations | PR 14A → main | `node scripts/verify-crew-admin-runtime.mjs` | Authenticated admin/supervisor/denied-role RPC and mutation cases | Remove new domain files; if applied, use deliberate inverse migration for the RPC |
| 14B | Protected `/equipos` UI and visible links | PR 14B → main | `node scripts/verify-crew-admin-ui.mjs` | `node scripts/verify-crew-admin-routes.mjs` with authenticated roles | Revert `/equipos`, `crew-manager` and links only |

## Phase 1: Schema & RLS

- [x] 1.1 Create migration `supabase/migrations/20260810_jobs_module.sql` with enums `job_status`, `incident_type`, `assignee_type`, `job_category`.
- [x] 1.2 Create tables `jobs`, `crews`, `crew_members`, `job_assignments`, `job_status_history`, `job_production_codes`, `job_photos`; add `category` column to `jobs`.
- [x] 1.3 Add trigger to insert `job_status_history` on status/incident changes.
- [x] 1.4 Create RLS policies: admin/supervisor full access; technician sees only assigned jobs.
- [x] 1.5 Create Storage buckets `project-files` and `job-evidence` with RLS.
- [x] 1.6 Apply migration in Supabase.
- [x] 1.7 Run `npm run lint` and `npm run build`.

### Work Unit 1 Evidence — Schema, migrations and RLS

| Evidence | Result |
|---|---|
| Focused static SQL check | PowerShell structural audit plus office-transition correction audit, exit 0: approved forward/return paths present, combined status/incident changes rejected, non-empty return reason required, office early return absent, and business timestamps set. |
| Project quality checks | `npm run lint`, exit 0; `npm run build`, exit 0, including successful Next.js compilation and TypeScript check. |
| Runtime harness | `node scripts/verify-jobs-rls.mjs`, exit 0: 77 checks passed across 7 tables, 2 private buckets, office access, direct/crew assignment, foreign/inactive/anonymous denial, technician writes, history actor and private Storage; `service_role` was limited to setup/cleanup, which passed for 6 users, 3 jobs, 1 crew and 2 objects. |
| Rollback boundary | Revert `scripts/verify-jobs-rls.mjs` and the Phase 1 evidence update independently; rolling back the applied schema requires a deliberate inverse Supabase migration and is not performed by this harness. |

## Phase 2: Domain Layer

- [x] 2.1 Create `src/lib/jobs/types.ts` with Job, Crew, Assignment types and enums.
- [x] 2.2 Create `src/lib/jobs/state.ts` with `canTransition` state machine.
- [x] 2.3 Create `src/lib/jobs/actions.ts` with server actions: `createJob`, `updateJob`, `assignJob`, `transitionJob`, `setIncident`, `addProductionCode`, `addPhotoComment`, `assignJobsInBulk`.
- [x] 2.4 Create `src/lib/storage/actions.ts` for signed upload URLs to Storage, including bulk PDF upload for job import.
- [x] 2.5 Add `requireSupervisor()` helper to `src/lib/auth/session.ts`.

### Work Unit 2A Evidence — Domain core, state and guards

| Evidence | Result |
|---|---|
| Focused test | `node scripts/verify-job-domain.mjs`, exit 0: 18 transition cases, 7 state helper checks, 10 type contracts and 4 supervisor-guard contracts passed. |
| Project quality checks | `npm run lint`, exit 0; `npm run build`, exit 0, including successful Next.js compilation and TypeScript check. |
| Runtime harness | The focused Node harness imports the real `state.ts` module and verifies valid/invalid role, status, incident-only, combined-change and reason-required scenarios. No external service boundary exists in this work unit. |
| Rollback boundary | Revert `scripts/verify-job-domain.mjs`, the optional `TransitionInput.reason` contract and return-reason validation in `src/lib/jobs/state.ts`, plus these task/evidence updates; Kimi's valid types and session guard remain independent. |

### Work Unit 2B Evidence — Server actions and private storage

| Evidence | Result |
|---|---|
| Focused checks | `node scripts/verify-job-domain.mjs`, exit 0: 8 job actions, 4 storage actions and 2 atomic-assignment RPC contracts; `npm run lint` and `npm run build`, exit 0. |
| Runtime harness | `node scripts/verify-job-assignment-rpc.mjs`, exit 0: 51 checks passed for individual assignment, reassignment to crew with the prior row retained inactive, two-job bulk assignment, assignment history and actor, technician denial, invalid-job batch rollback, and active-primary uniqueness; cleanup passed for 4 users, 3 jobs and 1 crew. `service_role` is confined to fixture setup/cleanup and is absent from the 8 job actions and 4 Storage actions. |
| Rollback boundary | Revert `scripts/verify-job-assignment-rpc.mjs` and this task/evidence update independently. Reverting assignment behavior requires a deliberate inverse migration for `20260810_jobs_assignment_rpc.sql`; the harness does not alter deployed schema or persistent business data. |

## Phase 3: Office UI

- [x] 3.1 Create `app/trabajos/page.tsx` with list and filters for admin/supervisor.
- [x] 3.2 Create `app/trabajos/nuevo/page.tsx` with job creation form.
- [x] 3.3 Create `app/trabajos/[id]/page.tsx` with detail, assignment, approval and payment actions.
- [x] 3.4 Create `app/trabajos/importar/page.tsx` for bulk PDF import and individual/bulk assignment.
- [x] 3.5 Create `src/components/jobs/job-form.tsx` for create/edit.
- [x] 3.6 Create `src/components/jobs/bulk-import.tsx` for multi-PDF upload and preview.
- [x] 3.7 Create `src/components/jobs/bulk-assign.tsx` for selecting jobs and assigning to technician/crew.
- [x] 3.8 Create `src/components/jobs/timeline.tsx` for status history.

### Work Unit 3A Evidence — Office list, create and detail

| Evidence | Result |
|---|---|
| Focused contract harness | `node scripts/verify-job-domain.mjs`, exit 0: 14 office UI contracts passed in addition to the existing domain suite, covering guards, awaited Next.js 16 route props, create/edit actions, assignment/status controls and timeline rendering. |
| Project quality checks | `npm run lint`, exit 0 with no warnings; `npm run build`, exit 0 with successful compilation, TypeScript validation and dynamic routes `/trabajos`, `/trabajos/nuevo`, `/trabajos/[id]`. |
| Runtime UI | N/A in this delegated background executor: the Sites capability-path instructions prohibit opening an interactive browser preview here, and no signed-in browser session was provided. Supabase assignment behavior remains covered by the 51-check live RPC harness. |
| Rollback boundary | Revert `app/trabajos/`, `src/components/jobs/job-form.tsx`, `src/components/jobs/office-job-actions.tsx`, `src/components/jobs/timeline.tsx`, `src/lib/jobs/queries.ts`, the office additions to `scripts/verify-job-domain.mjs`, and this evidence update; domain actions and migrations remain independent. |

### Work Unit 3B Evidence — Bulk PDF import and assignment

| Evidence | Result |
|---|---|
| Focused contract harness | `node scripts/verify-job-domain.mjs`, exit 0: 15 bulk UI contracts passed for office guard, multiple-file selection, server upload action, per-file retry excluding successes, imported-job handoff, checkbox selection and atomic bulk action. |
| Project quality checks | `npm run lint`, exit 0 with no warnings; `npm run build`, exit 0 with successful compilation, TypeScript validation and dynamic `/trabajos/importar` route. |
| Runtime UI | N/A in this delegated background executor because no authenticated interactive browser session is available. Runtime Storage/RLS and assignment RPC behavior remain covered by the prior 77-check and 51-check live harnesses; full file-import flow remains scheduled in task 5.5. |
| Rollback boundary | Revert `app/trabajos/importar/page.tsx`, `src/components/jobs/bulk-import.tsx`, `src/components/jobs/bulk-assign.tsx`, `listAssigneeOptions` in `src/lib/jobs/queries.ts`, the import link, focused harness additions and this evidence update. Existing office pages, actions and migrations remain independent. |

## Phase 4: Technician Mobile UI

- [x] 4.1 Create `src/components/jobs/job-list.tsx` with large cards for mobile.
- [x] 4.2 Create `src/components/jobs/technician-actions.tsx` with big state/incident buttons.
- [x] 4.3 Create `src/components/jobs/photo-upload.tsx` for evidence photos.
- [x] 4.4 Create `src/components/jobs/code-input.tsx` for production codes.
- [x] 4.5 Update `app/trabajos/page.tsx` to render technician view when role is `tecnico`.
- [x] 4.6 Update `app/trabajos/[id]/page.tsx` to render technician detail view.

### Work Unit 4 Evidence — Technician mobile interface

| Evidence | Result |
|---|---|
| Focused contract harness | `node scripts/verify-job-domain.mjs`, exit 0: 25 technician UI contracts passed for role branches, RLS-scoped queries, large touch targets, allowed transitions, orthogonal incidents, signed private PDF access, camera/file evidence upload, comments and positive production codes. The existing 18 transition cases and all domain/office contracts also remained green. |
| Project quality checks | `npm run lint`, exit 0 with no warnings; `npm run build`, exit 0 with successful Next.js compilation, TypeScript validation and dynamic `/trabajos` and `/trabajos/[id]` routes. A non-failing Node module-type warning in the standalone TypeScript harness remains outside this unit. |
| Security boundary | Static scan found no `service_role`, `SUPABASE_SERVICE_ROLE_KEY` or privileged client in the technician pages, components, or queries. Reads and writes use the authenticated Supabase clients and deployed RLS; private files use signed URLs. |
| Runtime UI | Pending Phase 5: no authenticated interactive technician browser session is available in this delegated executor. The prior 77-check live RLS harness proves assigned/unassigned visibility and private Storage policy behavior, but the complete mobile gesture/camera journey still requires an authenticated browser/device. |
| Rollback boundary | Revert the four technician components, technician role branches in the two jobs pages, `listTechnicianJobs`/`getTechnicianJob`, the focused harness additions and this evidence block. Office pages, domain actions and migrations remain independent. |

## Phase 5: Verification

- [x] 5.1 Test state machine transitions with valid and invalid cases.
- [x] 5.2 Test office flow: create → assign → approve → pay.
- [x] 5.3 Test technician flow: view assigned → start → incident → submit for review.
- [x] 5.4 Test RLS: technician cannot see unassigned jobs.
- [x] 5.5 Test bulk PDF import: upload multiple PDFs → create draft jobs with title = PDF filename → search by PDF filename → assign individual and in bulk.
- [x] 5.6 Run `npm run lint` and `npm run build`.

### Work Unit 5 Evidence — Final runtime verification

| Evidence | Result |
|---|---|
| State and contract harness | `node scripts/verify-job-domain.mjs`, exit 0: 18 valid/invalid transition cases plus all 25 technician, 15 bulk, 14 office, 8 action, 4 Storage and 2 RPC contracts passed. |
| Live RLS and assignment harnesses | `node scripts/verify-jobs-rls.mjs`, exit 0: 77 checks, cleanup passed (6 users, 3 jobs, 1 crew, 2 objects). `node scripts/verify-job-assignment-rpc.mjs`, exit 0: 51 checks, cleanup passed (4 users, 3 jobs, 1 crew). |
| Final live workflow harness | `node scripts/verify-jobs-final.mjs`, exit 0: 68 checks, cleanup passed (3 users, 6 jobs, 3 objects). It proved invalid transition rejection; office create/assign, technician submit, office approve/pay with timestamps and history; technician assigned visibility, start, incident set/clear and review submission; unassigned denial; three private PDF imports with filename titles/defaults/search, invalid-file partial result, individual/bulk assignment, retry reuse and no duplicate rows. |
| Credential and cleanup boundary | The final live harness creates authenticated role clients for all business operations. `service_role` is read only by this server-side script and used only for temporary identity/profile setup plus `finally` cleanup; no secret or fixture PII is printed. |
| Project quality checks | `npm run lint`, `npx tsc --noEmit`, and `npm run build`, all exit 0. Next.js 16 compiled and generated all routes. The standalone domain harness emitted only the known non-failing Node module-type warning. |
| Manual residual | No functional requirement remains unverified. Authenticated browser ergonomics, responsive appearance and physical camera behavior remain a manual device smoke check because this executor has no authenticated interactive browser/device session. |
| Rollback boundary | Revert `scripts/verify-jobs-final.mjs` and this Work Unit 5 evidence/checklist update. Application code, migrations and prior harnesses remain unchanged. Temporary Supabase fixtures were already removed by `finally`. |

## Phase 6: Database Evidence Remediation

- [x] 6.1 Verify bulk assignment to a crew, member visibility, and ambiguous-assignee rejection with authenticated role clients.
- [x] 6.2 Verify invalid crew leads, explicit member addition, duplicate membership rejection, and own/foreign crew queries.
- [x] 6.3 Verify correction return with a required reason and audited history.
- [x] 6.4 Verify foreign incident mutation denial and authorized production-code reads.
- [x] 6.5 Run the affected runtime harnesses, lint, TypeScript, and build; record cleanup, hashes, and rollback evidence.

### Work Unit 6 Evidence — Database verification remediation

| Evidence | Result |
|---|---|
| Remediated verification | Addresses failed evidence revision `sha256:0d2316a825275113a3080ad9280365e10d598c1b642c9b044894f104bf67d1ef` for database scenarios only. No production bug was found and no migration or application behavior changed. |
| Expanded live harness | `node scripts/verify-jobs-final.mjs`, exit 0: 112 checks, cleanup passed (5 users, 8 jobs, 1 crew, 3 objects). New authenticated scenarios prove two-job bulk assignment to crew and visibility for lead/member, ambiguous row rejection, inactive/non-technician lead rejection, explicit member addition, duplicate rejection, own/foreign crew and membership queries, reason-required correction return with actor/notes audit, foreign incident denial without history, and assigned production-code read. |
| Regression harnesses | `node scripts/verify-job-domain.mjs`, exit 0 (`transitions=18`, `technician_ui=25`); `node scripts/verify-jobs-rls.mjs`, exit 0 (`checks=77`, cleanup passed); `node scripts/verify-job-assignment-rpc.mjs`, exit 0 (`checks=51`, cleanup passed). |
| Project quality checks | `npm run lint`, `npx tsc --noEmit`, and `npm run build`, all exit 0. Next.js 16 compilation, TypeScript validation, route generation and lint remained green. |
| Credential and cleanup boundary | Business operations use authenticated supervisor/technician clients. `service_role` remains server-side in the harness and is used only for temporary identity/profile setup and `finally` cleanup. Output contains counts and generic labels only; no secrets, emails, IDs or other fixture PII are printed. |
| Rollback boundary | Revert the Unit 6 additions in `scripts/verify-jobs-final.mjs` and this Phase 6 task/evidence section. No production code, database migration, deployed policy or prior evidence must be reverted. All temporary Supabase resources were removed by `finally`. |

## Phase 7: Action and Evidence Remediation

- [x] 7.1 Extract import and signed-file logic into authenticated-client cores used by the existing server actions.
- [x] 7.2 Execute the real import core for multiple PDFs, invalid-file partial results, filename search, and idempotent retry.
- [x] 7.3 Execute real signed PDF/photo authorization for assigned and foreign technicians, including invalid MIME and size.
- [x] 7.4 Verify interrupted photo upload, successful retry, confirmation metadata, and idempotent reconfirmation.
- [x] 7.5 Run all regressions, lint, TypeScript, and build; record hashes, cleanup, credential boundary, and rollback.

### Work Unit 7 Evidence — Action and private-evidence remediation

| Evidence | Result |
|---|---|
| Real action logic | Existing server actions retain `requireSupervisor()`/`requireProfile()` and now delegate to `src/lib/storage/core.ts`. `scripts/verify-job-actions-runtime.mjs` imports those exact cores; static delegation checks prove the product actions call them, with no test endpoint added. |
| Live action harness | `node scripts/verify-job-actions-runtime.mjs`, exit 0: 49 checks, cleanup passed (3 users, 2 jobs, 3 objects). It proves two real PDF imports plus one isolated non-PDF failure, defaults/private paths, no invalid job, real-core retry reuse without duplicates, filename search, assigned/foreign signed PDF and photo authorization, MIME/size rejection without metadata, interrupted upload rejection, successful signed-token retry, attributed metadata, idempotent reconfirmation and signed photo download denial for the foreign technician. |
| Defect corrected | Photo reconfirmation previously inserted duplicate metadata for an already-confirmed path. `confirmPhotoEvidence` now returns the existing confirmation and the live harness proves exactly one `job_photos` row after reconfirmation. |
| Fail-fast regression | `cmd /d /c "node scripts/verify-job-domain.mjs && node scripts/verify-jobs-rls.mjs && node scripts/verify-job-assignment-rpc.mjs && node scripts/verify-jobs-final.mjs && node scripts/verify-job-actions-runtime.mjs && npm run lint && npx tsc --noEmit && npm run build"`, exit 0: domain PASS, RLS 77 cleanup passed, RPC 51 cleanup passed, final 113 cleanup passed, action runtime 49 cleanup passed, lint/TypeScript/build PASS. |
| Credential boundary | All business calls use authenticated supervisor/technician clients. `service_role` exists only in server-side runtime harness setup/`finally` cleanup. Outputs contain only counts/generic labels and expose no secrets, emails, UUIDs or fixture PII. |
| Rollback boundary | Re-inline the delegated logic into `src/lib/storage/actions.ts` and the photo branch of `src/lib/jobs/actions.ts`, then remove `src/lib/storage/core.ts`, `scripts/verify-job-actions-runtime.mjs`, the two updated legacy assertions and this Phase 7 section. No migration, deployed policy or prior evidence needs rollback; all runtime fixtures were removed. |

## Phase 8: Authenticated Route and UI Remediation

- [x] 8.1 Start the compiled Next application and verify all six authenticated route-guard scenarios using Supabase SSR cookies.
- [x] 8.2 Render a technician list containing direct and crew assignments while excluding a foreign job, plus an empty technician list.
- [x] 8.3 Render assigned technician detail controls and deny/not-found a foreign detail request.
- [x] 8.4 Execute a recoverable upload-error feedback component and prove retry context without clearing unconfirmed inputs.
- [x] 8.5 Run all regressions, lint, TypeScript, and build; record process cleanup, fixture cleanup, hashes, and rollback.

### Work Unit 8 Evidence — Authenticated routes and rendered field UI

| Evidence | Result |
|---|---|
| Real Next runtime | `node scripts/verify-job-routes-runtime.mjs`, exit 0: 39 checks, `server=stopped`, cleanup passed (4 users, 3 jobs, 1 crew). The harness starts `next start` from the compiled application on an ephemeral loopback port, creates Supabase SSR cookies, requests real routes and adds no product test endpoint. |
| Route guards | Runtime HTML proves admin `/usuarios`; technician access-denied navigation without protected user UI; supervisor `/trabajos/nuevo` through `requireRole("supervisor")`; technician denial from `/trabajos/importar`; supervisor office `/trabajos`; and technician field `/trabajos` without office controls. Next 16 streams redirect/not-found signals in 200 documents for these requests, so the harness asserts the document navigation/fallback signal plus absence of protected content. |
| Technician render scenarios | One authenticated technician renders direct and crew cards while a foreign title is absent; a second technician renders the empty state; assigned detail renders start, incident, code and evidence controls using native keyboard-operable elements; foreign detail renders not-found without its title. |
| Recoverable UI | `UploadFeedback` is executed with React server rendering, proving `role=status`, retained pending filename and explicit retry instruction. `PhotoUpload` clears pending context only after confirmed success; failed upload branches preserve both the file input and pending filename. Physical device camera invocation remains a manual smoke warning, while the functional file-upload path is covered by Phase 7. |
| Fail-fast regression | Full command covering domain, RLS, RPC, final DB, action runtime, lint, `tsc`, build and route runtime exited 0. A final focused route run after adding the keyboard-semantic assertion passed 39 checks; no product code changed after the full regression. |
| Security and rollback | Business fixtures use authenticated role clients; `service_role` is server-side setup/`finally` cleanup only. No cookies, secrets, emails, UUIDs or fixture PII are printed. Rollback: remove `scripts/verify-job-routes-runtime.mjs` and `upload-feedback.ts`, restore `photo-upload.tsx` feedback, restore the prior `requireSupervisor` check and domain assertion, then remove this Phase 8 section. |

## Phase 9: Bulk Import Presentation and Search Remediation

- [x] 9.1 Extract the row/outcome/retry model used by `BulkImport` and render mixed success/failure results through the shared component.
- [x] 9.2 Execute retry selection against the shared model, proving only failures are resubmitted and confirmed jobs remain unique.
- [x] 9.3 Import a PDF through the real core and request authenticated `/trabajos?q=<filename>`, proving only matching titles render.
- [x] 9.4 Run full regressions, lint, TypeScript, build and route runtime; record cleanup, hashes, credential boundary and rollback.

### Work Unit 9 Evidence — Bulk result presentation and office search

| Evidence | Result |
|---|---|
| Executed product model | `BulkImport` now uses `bulk-import-model.ts` for row creation, outcome merging, retry targets, imported-job projection and result rendering. `node scripts/verify-bulk-import-ui.mjs`, exit 0: 10 checks prove runtime-rendered success/failure rows, retry containing only the failed PDF, exclusion of the confirmed PDF, two unique confirmed jobs, no further retry targets and no stale failure after rerender. The harness executes the shared product model rather than duplicating it. |
| Authenticated product search | `verify-job-routes-runtime.mjs` imports one PDF through the real `importProjectPdfs` core, starts compiled Next, and requests authenticated `/trabajos?q=<filename>`. Exit 0: 43 checks, `server=stopped`, cleanup passed (4 users, 4 jobs, 1 crew, 1 object); the imported filename renders and three unrelated titles are absent. |
| Full fail-fast regression | `cmd /d /c "node scripts/verify-job-domain.mjs && node scripts/verify-jobs-rls.mjs && node scripts/verify-job-assignment-rpc.mjs && node scripts/verify-jobs-final.mjs && node scripts/verify-job-actions-runtime.mjs && node scripts/verify-bulk-import-ui.mjs && npm run lint && npx tsc --noEmit && npm run build && node scripts/verify-job-routes-runtime.mjs"`, exit 0. All domain/runtime suites, lint, TypeScript and build passed. |
| Cleanup and credentials | Route harness removed the imported private object before its job, then removed all other jobs, crew and users in `finally`; Next stopped. Business operations use authenticated clients, `service_role` remains setup/cleanup only, and no cookies, secrets, emails, UUIDs or fixture PII are printed. |
| Rollback boundary | Re-inline the prior local row logic/rendering in `bulk-import.tsx`, remove `bulk-import-model.ts` and `verify-bulk-import-ui.mjs`, remove the imported-search additions from `verify-job-routes-runtime.mjs`, restore the prior domain assertion and delete this Phase 9 section. No migration, policy or earlier remediation is affected. |

## Phase 10: High-volume import contract and extraction

- [x] 10.1 Extend the existing bulk-import specs/design for editable extraction, explicit suggestions, SHA-256/order deduplication, bounded concurrency and five observable states.
- [x] 10.2 Add a PDF parser/model that extracts the real fields in `6556114.pdf` without inventing customer data.
- [x] 10.3 Verify multiple valid rows, invalid PDF isolation, search/filter/pagination and retry-target selection.

### Work Unit 10 Evidence — Real PDF extraction and high-volume model

| Evidence | Result |
|---|---|
| Real document | `scripts/verify-bulk-pdf-parser.mjs` reads `C:\Users\goofy\Downloads\6556114.pdf` with the shipped PDFium WASM and verifies 3 physical pages, PRISM 6556114, 2026-02-10, street/city/state/ZIP, Span Replacement, detailed work, Wilfredo B. as suggestion only, and null customer. |
| Focused harness | `node scripts/verify-bulk-pdf-parser.mjs`, exit 0: 19 checks, 2 valid files analyzed with concurrency 2, invalid magic rejected, identical bytes produce identical SHA-256, 120 rows retained, retry-only-error, search/state filters, 50-row pagination and progress. |
| Dependency decision | PDF.js was rejected after the real document failed with `Invalid Root reference`; PDFium extracts the same correct text visible in Chrome. `@embedpdf/pdfium` is loaded only by the import client and its 4.6 MB WASM is self-hosted as `public/pdfium.wasm`. |
| Rollback boundary | Remove `pdf-parser.ts`, parser harness, PDFium dependency/WASM and Phase 10 spec/model additions. Existing import action, Storage core, migration and assignment RPC remain untouched. |

## Phase 11: Transactional persistence and assignment

- [x] 11.1 Add an additive migration for `jobs.customer_name`, `jobs.request_date`, one-to-one `job_imports`, unique order/hash constraints, RLS and `confirm_job_import`.
- [x] 11.2 Reuse the authenticated Supabase client, private `project-files` bucket and assignment invariants; keep `service_role` out of product code.
- [x] 11.3 Verify imported/duplicate/error outcomes, exact one-job relationship, actor audit, individual/crew assignment and role denials.

### Work Unit 11 Evidence — Transactional import persistence

| Evidence | Result |
|---|---|
| Applied migration | The user applied `20260810_jobs_bulk_import.sql`; its preflight changed from an expected safe failure to a live PASS. The migration adds two nullable operational fields, one import-audit row per job, unique normalized order/hash identities, office-only RLS and one transactional confirmation RPC. |
| Authenticated runtime | `node scripts/verify-bulk-import-runtime.mjs`, exit 0: 51 checks, cleanup passed (5 users, 2 jobs, 1 crew, 2 retained objects). It uses the real `6556114.pdf`, imports as admin and supervisor, confirms direct/crew assignment, detects duplicate hash and duplicate order, audits both actors and proves direct/crew/foreign technician visibility. |
| Credential boundary | Product parsing, signed upload and RPC confirmation use the browser's authenticated Supabase client. `service_role` appears only in server-side fixture setup and `finally` cleanup; no credentials or fixture identities are printed. |
| Failure isolation | Duplicate and error outcomes remove only the newly uploaded object; an exception after upload also triggers best-effort removal. Unique races roll back the proposed job and return the existing job identity. |
| Rollback boundary | Revert the additive migration with a deliberate inverse migration, then remove `import-core.ts`, the bulk-import branch in `storage/core.ts`, the runtime harness and this evidence. Existing jobs and assignment RPC remain independent. |

## Phase 12: Scalable office UI and release

- [x] 12.1 Extend `BulkImport` with drag/drop, editable rows, per-row selector, bulk selection/assignment, progress, filters and 50-row pagination.
- [x] 12.2 Change the office CTA to `Importar trabajos` while preserving `/trabajos/importar`.
- [x] 12.3 Run existing harnesses, focused parser/runtime tests, lint, TypeScript and build.
- [ ] 12.4 Complete an authenticated visual flow with the real PDF, apply the migration, deploy production and run smoke checks.

### Work Unit 12 Evidence — Scalable office UI (release pending)

| Evidence | Result |
|---|---|
| Product-model UI | `verify-bulk-import-ui.mjs` PASS (21 checks): independent imported/duplicate/error rows, retry-only-errors, no duplicate retry, search/state filters, 50-row pages, drag/drop, bounded parse/upload concurrency, direct private upload, bulk assignment and explicit suggestion UI. |
| Real extraction | `verify-bulk-pdf-parser.mjs` PASS (19 checks): two valid files, invalid isolation and 120 retained rows. The reference extracts order 6556114, 2026-02-10, 1587 ShallCross Ave, Orlando FL 32826, Span Replacement and Wilfredo B. as suggestion; customer stays null. |
| Full regression | Fail-fast run passed domain (18 transitions, 19 bulk contracts), RLS 77, assignment RPC 51, final DB 113, action runtime 49, bulk UI 21, parser 19, new bulk runtime 51, lint, TypeScript and production build. The final route fixture was updated from a four-byte pseudo-PDF and old CTA copy, then `verify-job-routes-runtime.mjs` passed 48 checks with server/fixture cleanup. |
| Release gate | Authenticated visual verification remains open because the Browser integration returned no available browser after documented discovery. Production deployment and smoke checks intentionally remain gated on that visual pass. |

## Phase 13: Direct-upload corrective architecture

- [x] 13.1 Amend the existing delta specs/design to forbid PDF bytes in Server Actions and require 50–100 rows, signed direct upload, resumable items, hash+size identity and grouped assignment.
- [x] 13.2 Add a new corrective migration `20260810_jobs_bulk_import_resume.sql`; do not edit the applied bulk migration.
- [x] 13.3 Replace `uploadProjectPdfs(FormData)` with metadata-only prepare/confirm Server Actions and verify Storage object existence, MIME, size and PDF header.
- [x] 13.4 Persist/reuse batch items for interruption recovery and make confirmation idempotent by item, hash and size.
- [x] 13.5 Keep per-row assignees and bulk apply, then group confirmed job IDs by assignee and call `assignJobsInBulk` in chunks of at most 100.
- [x] 13.6 Prove the real 4 MB PDF uses direct upload, interruption/recovery, repeated confirmation, same-name/different-content, repeated hash, partial failures, distinct assignees, role denials and at least 50 simulated files.
- [x] 13.7 Run every jobs harness, lint, TypeScript and build; statically prove no PDF bytes enter a Server Action.
- [x] 13.8 Apply the corrective migration in Supabase and rerun the live harnesses before visual verification or deployment.

### Work Unit 13A Evidence — Contract correction

| Evidence | Result |
|---|---|
| Source defect | `uploadProjectPdfs(formData: FormData)` still accepts files in `src/lib/storage/actions.ts`, and legacy runtime/route harnesses call its core. This preserves a path that fails before product logic for the approximately 4 MB reference PDF. |
| Approved boundary | New migration plus metadata-only actions/cores, resumable batch/items, direct browser upload and focused runtime harness. Applied migration files remain byte-for-byte unchanged. |
| Delivery strategy | Corrective work continues as `stacked-to-main` units under the previously authorized high-risk workload plan; no `size:exception` is used. |
| Rollback boundary | Revert only Phase 13 artifacts, the new corrective migration, metadata-only actions/cores, UI orchestration and corrective harnesses. Do not revert applied Phase 11 schema or unrelated Kimi changes. |

### Work Unit 13A Backend Evidence — Resumable metadata boundary

| Evidence | Result |
|---|---|
| RED → GREEN | `node scripts/verify-bulk-import-resume.mjs` first failed with `ERR_MODULE_NOT_FOUND` for the absent corrective core. After implementation it exits 0 with 19 checks covering metadata rejection, signed preparation, batch/item reuse, Storage MIME/size/header verification, idempotent confirmation contracts and absence of assignment writes. `node scripts/verify-job-domain.mjs` also passes with five metadata-only Storage actions. |
| Metadata-only boundary | `src/lib/storage/actions.ts` exposes only `prepareBulkProjectUpload(input)` and `confirmBulkProjectUpload({ itemId })`; the legacy multipart action and byte-reading import core were removed. Browser PDF bytes are not accepted by either Server Action. |
| Corrective schema | New unapplied migration `20260810_jobs_bulk_import_resume.sql` adds audited file size, hash+size uniqueness, office-owned batches/items and idempotent prepare/confirm RPCs. It does not assign jobs and no applied migration was edited. |
| Quality checks | `npm run lint`, `npx tsc --noEmit` and `npm run build`, exit 0. Next.js 16 compiled all routes. |
| Runtime boundary | Live Supabase execution is intentionally N/A until the user applies the new migration. The focused core harness executes authenticated-client call shapes and Storage validation with deterministic mocks; no deployment or migration application occurred. |
| Rollback boundary | Remove `20260810_jobs_bulk_import_resume.sql`, `bulk-import-core.ts` and `verify-bulk-import-resume.mjs`; restore the prior `uploadProjectPdfs` action and `importProjectPdfs` core plus these three checkboxes. UI work and all applied migrations remain untouched. |

### Work Unit 13B Evidence — Direct upload orchestration and grouped assignment

| Evidence | Result |
|---|---|
| RED → GREEN | The expanded `verify-bulk-import-resume.mjs` first failed because `groupAssignmentChunks` did not exist. It now exits 0 with 40 checks for the hardened schema/core, strict partial Range response, resumable preparation, 100-ID chunks, per-assignee grouping and exclusion of duplicate/already-assigned rows. |
| Browser orchestration | `BulkImport` calls metadata-only prepare/confirm actions, sends the `File` only to browser `uploadToSignedUrl`, persists the batch ID, limits the UI to 100 rows and keeps upload concurrency at three. It contains no direct import RPC or direct signed-URL creation. |
| Assignment recovery | Only imported jobs with an explicit per-row assignee are grouped by type/ID. Assignment failures leave the PDF imported and expose `Reintentar asignaciones`, which calls only `assignJobsInBulk` without uploading or confirming again. |
| SQL hardening | The still-unapplied corrective migration enforces 100 items, safe stored names and lengths, legacy size-zero dedupe, Storage MIME/size inside the confirmation RPC, correct imported item state, and revokes authenticated access to the legacy confirmation RPC. Signed uploads use `upsert: true`; header verification accepts only HTTP 206 with an exact `Content-Range`. |
| Regression | `verify-bulk-import-ui.mjs` PASS (25), `verify-job-domain.mjs` PASS (`bulk_ui=21`, `storage=5`), `npm run lint`, `npx tsc --noEmit` and `npm run build` all exit 0. Live Supabase remains intentionally N/A until the corrective migration is applied. |
| Rollback boundary | Restore the pre-13B `BulkImport` and model, remove 13B hardening from the unapplied corrective migration/core, and revert the focused harness contracts and this checkbox. Metadata-only 13A actions and all applied migrations remain intact. |

### Work Unit 13C Prep Evidence — Concurrency, local dedupe and live-harness readiness

| Evidence | Result |
|---|---|
| Product hardening | The unapplied prepare RPC locks its batch row before counting/inserting, serializing concurrent prepares at the 100-item cap. Confirmation also takes a transaction-scoped advisory lock per real order identifier so concurrent files with different hashes cannot create duplicate orders. The browser model marks later hash+size matches as local duplicates, excludes them from upload/assignment, provides `Iniciar lote nuevo`, and permits correcting an assignee after an assignment-only failure. |
| Legacy removal | Deleted dead `src/lib/jobs/import-core.ts`. Product code has no legacy byte core, multipart action, client import RPC or direct signed-upload authorization. The action, route and final harnesses were migrated away from removed import contracts. |
| Prepared live harness | `verify-bulk-import-runtime.mjs` now uses prepare core → signed browser-equivalent upload → confirm core → assignment RPC. Its applied-state path covers the exact 4,005,680-byte PDF and audit size, interruption/reprepare, repeated confirmation, hash/item reuse, same-name/different-content with distinct hash+size, metadata failure, role denial, technician/crew assignment and full import audit. Existing parser/model harnesses exercise 120 rows, an explicit 50-file simulated batch and the 100-row cap/chunking. |
| Expected preflight | With the corrective migration intentionally unapplied, `node scripts/verify-bulk-import-runtime.mjs` exits 0 with `[bulk-import-runtime] EXPECTED_PRECHECK_FAIL migration=20260810_jobs_bulk_import_resume.sql cleanup=passed checks=0`. No fixtures are created. Tasks 13.6 and 13.7 remain unchecked until the live applied-state path runs. |
| Non-migration regression | Domain PASS; resume PASS 49 (`simulated=50`); bulk UI PASS 25; parser PASS 19/120 rows; RLS PASS 77; assignment RPC PASS 51; final PASS 113; action runtime PASS 39; routes PASS 47 with server/cleanup; lint, TypeScript and build PASS. Corrective migration SHA-256: `eb8f72c040363ae90c6e2a87454d8de64217a8b1cacf71bc649ddb74e6df7da3`; applied bulk migration remains `2bdd4f74c10006a5a635fd7eac4945a7abc81c31e02d3a5f0e7a4acf861c8e7c`. |
| Rollback boundary | Restore `import-core.ts` only together with the pre-13A legacy architecture, revert the 13C model/UI and batch-lock additions, and restore prior harness fixtures/assertions. Do not revert metadata-only actions, applied migrations or unrelated work. |

### Work Unit 13C Evidence — Applied direct-upload verification

| Evidence | Result |
|---|---|
| Live direct upload | After the user applied `20260810_jobs_bulk_import_resume.sql`, `node scripts/verify-bulk-import-runtime.mjs` passed 57 checks with cleanup passed. It uploaded the exact 4,005,680-byte reference PDF through a signed Storage URL, rejected confirmation before upload, resumed the same item, confirmed idempotently, and kept same-name/different-content files distinct by hash+size. |
| Permissions and audit | The live path proved admin/supervisor import, technician denial, direct and crew visibility, private import audit, original name/hash/exact size/importer/date, and assignment actor audit. Fixtures were removed: users 5, jobs 2, crews 1, batches 4, objects 4. |
| Scale and recovery | Metadata/model harnesses pass with 50 simulated files, 120 parser rows, three concurrent browser uploads, 100-row batches and 100-ID grouped assignment chunks. Partial upload/assignment failure and retry paths remain isolated and idempotent. |
| Full regression | Resume 49; bulk UI 25; parser 19/120; domain contracts; RLS 77; assignment RPC 51; final 113; actions runtime 39; routes runtime 47; lint, `tsc --noEmit`, production build and `git diff --check` pass. Storage Server Actions contain no `FormData`, `File`, `Blob`, `ArrayBuffer` or `Uint8Array`, and `next.config.ts` has no `bodySizeLimit` override. |
| Deployment gate | Corrective schema and live verification are complete. Authenticated visual verification remains separately pending in task 12.4; production deployment/smoke may proceed without claiming that visual task complete. |
| Production deployment | Vercel deployment `dpl_7seKxJaqU8wFn982CHjShZB5sscg` reached `READY` and was aliased to `https://portal.susotech.org`. Smoke checks: `/` redirects 307 to `/login`; `/login` renders the sign-in form without a 5xx; unauthenticated `/trabajos` and `/trabajos/importar` contain the Next redirect signal to `/login` and no protected import content. The explicitly paused authenticated visual flow remains unchecked in 12.4. |

## Phase 14: Administrative crew management

- [x] 14.1 Extend the existing `crew-management` spec with administrative list/empty, create/edit/deactivate, membership, eligibility and assignment scenarios.
- [x] 14.2 Extend `design.md` with `/equipos`, granular atomic mutations, limited directory RPC, rollout, rollback and threat matrix.
- [x] 14.3 **14A RED:** create `scripts/verify-crew-admin-runtime.mjs`; prove admin/supervisor receive only active technicians shaped exactly `{id,label}`, while technician/inactive/anonymous and forced crew Server Actions are denied.
- [x] 14.4 Add new `supabase/migrations/20260810_jobs_crew_directory.sql` with authorized `security definer` RPC, fixed columns, empty `search_path`, public revoke/authenticated grant; do not edit applied migrations or relax `profiles` RLS.
- [x] 14.5 Extend `src/lib/jobs/types.ts`, `queries.ts` and `actions.ts` with serializable crew DTOs, RPC composition and validated granular create/edit/activate/member actions; reject removing the lead and revalidate affected routes.
- [x] 14.6 Turn deterministic 14A core/action/query contracts GREEN for validation, atomic failure and role guards; run a live preflight that exits safely as migration-pending without claiming authenticated runtime compliance, and record hash/rollback.
- [x] 14.7 **14B RED:** create UI/route harnesses for direct `/equipos` access by admin/supervisor versus technician/inactive/anonymous, forced actions, keyboard operation, list/empty/error states and no protected-data leak.
- [x] 14.8 Create `app/equipos/page.tsx`, `loading.tsx`, `error.tsx` and `src/components/jobs/crew-manager.tsx` with Server Component guard/data load and client-only forms, confirmations and per-action feedback.
- [x] 14.9 Add role-visible `/equipos` links in `src/components/dashboard-client.tsx` and `app/trabajos/page.tsx`; keep technicians excluded.
- [x] 14.10 Turn 14B UI/model/static/guard harnesses GREEN without the RPC, including active/inactive selector projection; run a safe migration-pending route preflight without claiming real admin or member behavior.
- [ ] 14.11 Run all jobs harnesses, `npm run lint`, `npx tsc --noEmit`, `npm run build` and `git diff --check`; preserve task 12.4.
- [ ] 14.12 Apply the new SQL manually, then prove with authenticated admin/supervisor/technician/inactive/anonymous clients: limited directory shape, eligibility, mutations, forced denials, active/inactive selectors, member access to crew-assigned work and cleanup; complete browser flow, deploy Vercel and smoke production.

### Work Unit 14 Rollback

14A can revert the new RPC migration/domain changes independently; after SQL application it requires an additive inverse migration. 14B can revert `/equipos`, `crew-manager` and both links without removing crews, assignments or prior jobs functionality.

### Work Unit 14A Evidence — Crew directory and domain

| Evidence | Result |
|---|---|
| Threat RED → GREEN | First focused run failed with `ERR_MODULE_NOT_FOUND` for absent `src/lib/jobs/crew-core.ts`. `node --experimental-strip-types scripts/verify-crew-admin-runtime.mjs` now exits 0 with 19 deterministic checks for the exact two-column directory, active-technician filter, office denial boundary, action guards, validation, single mutation and atomic lead membership. |
| Safe live preflight | The same command calls the live anonymous RPC endpoint and exits 0 with `[crew-admin-runtime] EXPECTED_PRECHECK_FAIL migration=20260810_jobs_crew_directory.sql cleanup=passed checks=19`. It creates no fixtures and does not claim authenticated runtime compliance before SQL application. |
| Domain and quality | `node scripts/verify-job-domain.mjs`, `npm run lint`, `npx tsc --noEmit`, `npm run build` and `git diff --check` exit 0. Next.js 16 compiles every existing route. |
| Security boundary | Product uses the authenticated server client only. The new definer RPC checks active office staff, returns only `{id,label}`, fixes `search_path`, revokes public execution and grants authenticated execution; no product `service_role` or relaxed profile policy was added. |
| Rollback boundary | Before SQL application, remove `20260810_jobs_crew_directory.sql`, `crew-core.ts`, the focused harness and the crew additions in types/queries/actions/tasks. After application, use an additive inverse migration before reverting product callers. |

### Work Unit 14B Evidence — Protected crew management UI

| Evidence | Result |
|---|---|
| Threat RED → GREEN | `node --experimental-strip-types scripts/verify-crew-ui.mjs` first failed with `ERR_MODULE_NOT_FOUND` for absent `crew-manager-model.ts`. It now passes 37 deterministic/model/route checks: admin/supervisor guard, technician/inactive/anonymous denial contracts, guard-before-query, serializable DTOs, five forced-action guards, native keyboard controls, confirmation, scoped pending/feedback, list/empty/error/loading states, office-only links, lead-removal prevention and active-only assignment projection. |
| Safe route preflight | The focused harness starts the compiled Next server, requests anonymous `/equipos`, accepts the Next 16 streamed `NEXT_REDIRECT` signal to `/login`, proves no protected heading leaks, stops the server, and then reports `[crew-ui] EXPECTED_PRECHECK_FAIL migration=20260810_jobs_crew_directory.sql anon_guard=covered cleanup=passed checks=37`. No fixtures are created and no admin/member live behavior is claimed. |
| UI boundary | `app/equipos/page.tsx` calls `requireSupervisor()` before the management query. `CrewManager` is the sole client interaction boundary and uses native forms/buttons/selects, explicit confirmations, recoverable action feedback and no optimistic membership state. Technicians return from `/trabajos` before office links render. |
| Quality | `node scripts/verify-job-domain.mjs`, `npm run lint`, `npx tsc --noEmit`, `npm run build` and `git diff --check` pass; build includes dynamic `/equipos`. Task 12.4 and live task 14.12 remain open. |
| Rollback boundary | Remove `app/equipos`, `crew-manager.tsx`, `crew-manager-model.ts`, the 14B harness and only the two `/equipos` links/query composition additions. Preserve 14A schema/actions and every prior jobs artifact. |
