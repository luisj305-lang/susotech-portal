# Design: Portal Workflow Improvements

## Technical Approach
**Conditional plan, not implementation approval.** Proposal #361 and eight change specs #363 govern; all [exploration prerequisite rows](exploration.md#twelve-request-traceability) (#360) remain unapproved. Preserve #353 labels. Evidence: bounded CodeGraph, #355/#15, installed Next.js component/route-handler guides, migrations `20260827000000`/`20260831020000`.

Finalized invariants: Server Components, interaction-only clients, guarded actions/RPCs, RLS/private Storage; unchanged accounting transitions, audit, routes, independent parts and optional shifts. No service-role bypass or payroll/immutable statements.

## Architecture Decisions
| Capability / option | Tradeoff | Decision |
|---|---|---|
| `job-queue` R01/R02/R03/R04/R06: separate projection versus shared-query rewrite | Routing consumes `listTechnicianJobs` | Separate queue; preserve visible families/search/URL/back; gate filters, “revisados”, “Asignado / En revisión / Aprobado”, priority and assignment-event selection. |
| `job-work-types` R05/R08; `multi-part-jobs` R08: array versus relation | Simplicity versus catalog governance | Defer schema; lossless create/import/edit/assign/copy round-trip; retain scalar/unknowns; gate catalog/display/write/part-copy policy and assignment/type-save atomicity. |
| `job-visual-fidelity` R07: reproduce versus speculate | Unknown cause | UNREPRODUCED; separate reproduction then evidence-selected fix. |
| `job-lifecycle` R11: delivery provenance versus job dates | Regeneration differs from submission | Qualify submitted `job_deliveries` by version/path/replacement; preserve financial `current_delivery_id`; missing evidence stays unknown. |
| `production-codes` R12: new default versus fallback change | Historical recoloring | Persist approved “azul rey” for new placements; retain missing-color black/explicit colors; gate shade/text/border/arrow/line scope. Version new text-color semantics without changing legacy rendering. |
| `companion-attendance` R09: attendance relation versus per-person shifts | Authority/lifecycle differ | Defer schema; authorized RPC validates companions, serializes affected people, projects presence without access/shares/duplicated fuel. |
| `financial-split-visibility` R10: personal RPC versus office totals | Privacy/reconciliation | One source-qualified snapshot; integer cents/basis-points; deduplicate parts; minimal coworker names, never coworker money. Format/source/amount/period remain gated. |

## Data Flow / Interfaces
`Controls → guarded server query → authorized RPC → DTO → UI`.
`Shift form → action → transactional RPC → presence`.
`Week → export GET → personal RPC → reconciled DTO → document`.

Proposed contracts:
- Queue: `jobId, familyId, rawStatus, responsibility, assignmentEventId, assigneeId, assignedAt, workTypes`; audited dates only; approved policy derives tab/label/rank outside routing. Fetch complete families before ordering.
- PDF: `visibleDeliveryId, submittedDeliveryId, draftVersion, submittedAt, relation`; first/latest policy gated, never substitute regeneration time.
- Export: `source, sourceId, jobId, deliveryId, allocationVersionId, PRISM, amountCents, percentageBasisPoints, coworkerNames`; authenticated viewer, private/no-store; reject inconsistent totals/partial reads.

## File Changes
Future only; existing impact inventory: [exploration](exploration.md#affected-areas). Braces enumerate paths.

| File | Action | Scope |
|---|---|---|
| `app/trabajos/{page.tsx,[id]/page.tsx}`; `src/lib/jobs/{queries,types,actions}.ts` | Modify later | Queue/provenance/types |
| `src/components/jobs/{job-list,job-form,bulk-import,office-job-actions,job-documents,pdf-code-editor}.tsx`; `src/components/technician/{job-header,job-progress}.tsx` | Modify later | Presentation |
| `src/lib/storage/{actions,bulk-import-core}.ts`; `src/lib/jobs/{pdf-code-editor-core,pdf-line-core,delivered-pdf}.ts` | Modify later | Import/color |
| `src/lib/work-shifts/{actions,types}.ts`; `src/components/work-shifts/start-shift-form.tsx`; `src/components/{dashboard-client,worker-operations-table}.tsx` | Modify later | Attendance/export |
| `src/lib/jobs/{queue-core,work-types,weekly-export}.ts`; `app/api/produccion/semanal/exportar/route.ts` | PROPOSED create | Projections/serialization/download |
| `supabase/migrations/20260905000000_portal_workflow_improvements.sql` | PROPOSED create, gated | Additive storage/RPC/RLS; no applied-migration edits |

## Testing Strategy
All future/unapplied; no runner exists. Check ad hoc script compatibility; carry complete #360 fixtures forward.

| Layer | Planned evidence |
|---|---|
| Unit | Approved queue policies, multi-type round-trips, missing-color compatibility, cents/basis-points, Friday–Thursday/New_York DST boundaries |
| Integration | Nonproduction admin/supervisor/technician/helper/inactive identities; RLS/IDOR, concurrent writes/starts, fuel-once, redelivery/regeneration, normal/manual/participant-only reconciliation |
| E2E/device | One-interaction keyboard/touch/back; mixed/filtered families; same-version desktop/real-mobile PDF; empty/error/retry |

Lint/build cannot prove authorization, concurrency, mobile or money correctness.

## Threat Matrix
HTTP export applies; supplied automation rows do not. Carry applicable rows unchanged into future tasks/RED tests.

| Boundary | Minimum adversarial cases | Applicability | Design response | Planned RED tests |
|---|---|---|---|---|
| Documentation-like paths | `requirements.txt`, `CMakeLists.txt`, executable Markdown/MDX, `README.sh` | N/A: no classification | N/A | None |
| Git repository selection | `git -C`, relative paths, absolute paths | N/A: no VCS automation | N/A | None |
| Commit state | staged, `commit -a`, empty index | N/A: no commits | N/A | None |
| Push state | tracking branch, first push, explicit refspec | N/A: no push | N/A | None |
| PR commands | explicit `--head`, environment prefix, composed commands | N/A: no PR automation | N/A | None |
| HTTP export | Forged viewer/week, inactive session, shared cache | Applicable | Derive viewer; validate period; deny invalid/unauthorized without data; private/no-store | Route/RPC RED: each case, cross-user body/cache leakage |

## Migration / Rollout
Gate DDL first; deploy additive readers before writes. Preserve legacy raw values; reject lossy old-client writes. Disable entry points/writes before reader rollback; retain audits, attendance, allocations/PDFs. No destructive rollback/regeneration. Mutations expose conflicts/errors, never false success.

## Open Questions
All #360 prerequisites block affected rule/schema finalization, not this draft. Assignment/submission first/latest, timezone/legacy, attendance authority/lifecycle and export currency/coworker/period semantics remain blocked. R10 depends on R09 only for attendance coworkers. Reconcile allocation-estimate spec drift and normal/manual aggregation explicitly; no automatic behavior change. `auto-chain`, budget 800; topology UNSELECTED. Source/earlier artifacts stay untouched; stop after design.
