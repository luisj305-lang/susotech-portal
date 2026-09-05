# Proposal: Portal Workflow Improvements

## Intent
Reduce technician/office friction in dispatch, documents, attendance and weekly reporting. Planning only; no implementation or inherited approvals.

## Scope
### In Scope
- Queue R01/R02/R03/R04/R06: one-interaction filters, prominent assignment-event date, approved/“revisados” second tab, “Asignado / En revisión / Aprobado” labels, assigned-work priority.
- Work scope R05/R08: technician-visible work types; admin multi-type assignment on one job; preserve all ten verbatim labels in [exploration](exploration.md#twelve-request-traceability).
- Documents R07/R11/R12: investigate/fix mobile color (unreproduced), submission time beside admin PDF, “azul rey” default.
- Attendance R09: shift-start companions appearing active.
- Export R10: previous-week document containing PRISM, amount, coworkers, earned percentage.

### Out of Scope
Accounting/authorization rewrites, route optimization changes, payroll/crew rewrites, immutable statements, historical recoloring.

## Capabilities
### New Capabilities
- `job-queue`: R01/R02/R03/R04/R06 role-aware filters/date/tabs/states/priority.
- `job-work-types`: multi-type assignment/display.
- `job-visual-fidelity`: R07, without assuming surface/cause.
- `companion-attendance`: R09 authorized companion presence.

### Modified Capabilities
- `job-lifecycle`: R11 submission-version timestamp display.
- `multi-part-jobs`: R08 multi-type copying; retain independent parts.
- `production-codes`: R12 annotation defaults, not work types.
- `financial-split-visibility`: R10 authorized export.

## Approach
Recommend capability slices over authoritative records with additive storage and role-specific projections. Preserve raw accounting, audit, invoicing, route and role-guard contracts. Assignment audit ≠ editable job date; submission ≠ regeneration; attendance ≠ financial participation. Reconcile only touched historical drift, including conflicting allocation-estimate specs; adopt no retired states or waivers.

## Affected Areas
| Area | Future impact |
|---|---|
| `app/trabajos/`; `src/components/{jobs,technician}/` | Modified: queue/types/documents |
| `src/lib/{jobs,work-shifts,fleet,manual-jobs}/`; `src/components/dashboard-client.tsx` | Modified: guarded data/presence/export |
| `supabase/migrations/` | New: additive changes if needed |

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Invented semantics; privacy/history loss | High | Approval gates; provenance/RLS regression scenarios |
| Mobile cause unknown | High | Same-document/device/build reproduction before fix selection |

## Rollback Plan
Withdraw this proposal if rejected. Later disable new entry points/writes before reverting compatible UI/readers; retain multi-value/legacy data, attendance, audit, allocations and PDF versions. No destructive down-migrations or history regeneration.

## Dependencies
All per-ID [exploration](exploration.md) prerequisites remain unapproved: queue/date, catalog/write, attendance/authority/fuel, export/source/period, submission/version, color/shade/scope, including timezone, legacy handling and atomicity. Resolve before finalizing affected rules/design. R07 evidence gates only its slice. R10 depends on R09 only for attendance coworkers.

`execution_mode: auto`; `artifact_store.mode: hybrid`; `delivery_strategy: auto-chain`; `review_budget_lines: 800`; `chain_strategy: UNSELECTED`. Topology requires explicit selection before delivery planning/apply.
References: Engram #15/#353/#355/#358/#360; `AGENTS.md`; `docs/00-PROYECTO.md`, `docs/01-ARQUITECTURA.md`, `docs/04-SEGURIDAD.md`.

## Success Criteria
- [ ] 12/12 requests traced to approved scenarios; unresolved gates explicitly blocked.
- [ ] One-interaction filters, multi-type round-trips and four-field export reconciliation demonstrated.
- [ ] Role/date/attendance/mobile-parity/legacy scenarios pass with zero accounting drift.
