# Archive Report — multi-part-jobs

**Archive date**: 2026-08-28
**Archive disposition**: intentional-with-warnings
**Verdict at close**: `pass_with_warnings` (verify-report), 0 blockers, 0 CRITICAL — archived with 2 documented follow-ups pending human execution against a live Supabase.

## Final State at Close

### Specs synced to main store

| Domain | Action | Details |
|--------|--------|---------|
| multi-part-jobs | Created (fresh main spec) | 5 requirements, 9 scenarios — mechanical copy, byte-identical (`cp` + empty `diff`) |
| job-lifecycle | Updated (additive delta applied) | +1 requirement ("Archivado y borrado con partes"), +3 scenarios; existing 4 requirements preserved |
| job-invoicing | Updated (additive delta applied) | +2 requirements ("Facturación independiente por parte", "Conteo único de partes en totales y reportes"), +3 scenarios; existing 4 requirements preserved |

### Destructive-merge review

No destructive delta merge performed. No delta contained REMOVED / MODIFIED / RENAMED sections:

- **`multi-part-jobs`**: no main spec existed for this domain; the delta is a full spec (not a delta) and was copied verbatim into `openspec/specs/multi-part-jobs/spec.md` (mechanical copy, byte-identical per `diff` readback).
- **`job-lifecycle`**: delta was `## ADDED Requirements` only; appended the one new requirement verbatim and preserved all 4 existing requirements.
- **`job-invoicing`**: delta was `## ADDED Requirements` only; appended the two new requirements verbatim and preserved all 4 existing requirements.

### Final-state facts (outrank verify-report / apply-progress snapshots)

Work completed AFTER the verify-report was written. Three of the four SUGGESTION items that were in scope were fixed; the fourth is out of scope and left for a separate change.

1. **SUGGESTION #1 — FIXED (corroborated in repository).** `deleteArchivedJob` (`src/lib/jobs/actions.ts:326-327`) now maps the FK-RESTRICT error `jobs_parent_job_id_fkey` to the specific Spanish message "No se puede eliminar este trabajo porque tiene partes asociadas." — satisfying spec job-lifecycle "Borrado de raíz con hijos bloqueado".
2. **SUGGESTION #2 — FIXED.** `design.md` open questions closed: `parent_job_id` immutability = yes (trigger `is distinct from`), clone `location`/`job_type` = yes (7 fields).
3. **SUGGESTION #3 — FIXED (reconciled in the committed delta spec).** `specs/multi-part-jobs/spec.md` "Copia de campos compartidos al crear una parte" now documents all 7 cloned fields (cliente, domicilio, PRISM, título, categoría, ubicación, tipo de trabajo), matching the implementation.
4. **SUGGESTION #4 — NOT fixed (out of scope).** Pre-existing lint warning `src/components/manual-jobs/manual-jobs-manager.tsx:65` (`currentUserId` unused) — unrelated to this change; fix separately.

### Known limitations (recorded honestly — NOT claimed fixed)

1. **DB SQL assertions (tasks 4.2/4.3) were NOT executed** — no Supabase CLI / psql / Docker / local Postgres in this environment. The migration/RPC were verified at SQL-source level only (lint + build green; static review confirms 7-field clone, full `parent_job_id` immutability, FK/CHECK/index, RPC gates/grant). Runtime DB behavior remains to be exercised against a live Supabase.
2. **Technician "Parte N" label gap** — when a technician is assigned to a child part whose root is NOT visible to them via RLS (root unassigned or assigned to a different technician), their list shows the part without the "Parte N" chip (`groupJobParts` orphan branch can't compute the sibling ordinal without the root). Cosmetic; the part remains self-contained and functional. Office list is fully correct. Future option: denormalize a `part_number` column at creation.

### Task completion

15/15 checked. No unchecked implementation tasks in `tasks.md`. Tasks 4.2 and 4.3 are Phase 4 VERIFICATION tasks marked complete with the honest annotation that the SQL assertions were documented but NOT executed (environment limitation) — recorded here as follow-ups, not stale checkboxes.

### Verification at close

- verify-report: verdict `pass_with_warnings`, blockers 0, critical_findings 0, requirements 8/8, scenarios 15/15.
- `npm run lint` exit 0 (1 pre-existing warning unrelated to this change) and `npm run build` exit 0 (Next.js 16.3.0, TypeScript passes) per verify-report; build still passes after the post-verify fixes (orchestrator final-state facts).

### Delivery (already complete)

2 commits pushed to `origin/main` (branch `main`, no PR workflow in this repo):

- `a7421d4` feat: trabajos multi-parte con partes hijas facturables por separado
- `11b175e` docs: plan, specs y verificación del cambio multi-part-jobs

### Review gate

No `reviewGate` was present in the received status and no `reviews/` artifacts exist for this candidate. Archive proceeded under ordinary repository policy.

## Mechanical Integrity Evidence

- Fresh main spec (`multi-part-jobs`): `Copy-Item` → `git diff --no-index` readback (empty, exit 0) → `Move-Item` → final `git diff --no-index` readback (empty, exit 0).
- Archive move: recursive pre-move snapshot → `Move-Item` → source-gone check passed → `git diff --no-index` (snapshot vs archived) empty, exit 0. No differences = no truncation or alteration.
- This archive report file was added AFTER the readbacks (additive-only, excluded from source/destination comparison).

## Archive Location

`openspec/changes/archive/2026-08-28-multi-part-jobs/` — preserved as audit trail, never deleted or modified.

## Follow-ups / Risks (open at close)

1. Runtime DB execution of the migration/RPC + SQL assertions (tasks 4.2/4.3) against a live Supabase — guards, clone, FK RESTRICT, and invoicing dedup are statically verified but unexecuted in this environment.
2. Technician "Parte N" label gap when the root is not RLS-visible — optional denormalized `part_number` column as a future improvement.
3. Pre-existing lint warning `manual-jobs-manager.tsx:65` (`currentUserId` unused) — unrelated, fix in a separate change.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. Source of truth updated. Ready for the next change.
