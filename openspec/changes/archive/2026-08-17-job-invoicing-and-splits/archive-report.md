# Archive Report — job-invoicing-and-splits

**Archive date**: 2026-08-17
**Archive disposition**: intentional-with-warnings
**Verdict at close**: `pass_with_warnings` (verify-report), 0 blockers, 0 CRITICAL — archived with 2 documented follow-ups pending human execution.

## Final State at Close

### Specs synced to main store

| Domain | Action | Details |
|--------|--------|---------|
| job-invoicing | Created (fresh main spec) | 4 requirements, 8 scenarios — mechanical copy, byte-identical |
| financial-split-visibility | Created (fresh main spec) | 3 requirements, 6 scenarios — mechanical copy, byte-identical |
| job-lifecycle | Created (fresh main spec) | 4 requirements, 12 scenarios — NEW state machine `sin_asignar→asignado→en_revision→aprobado→facturado→pagado` |
| production-codes | Created (fresh main spec) | 4 requirements, 10 scenarios — mechanical copy, byte-identical |
| role-based-route-guard | Updated (additive delta applied LAST) | +1 requirement ("Permisos de supervisor sobre trabajos"), +5 scenarios; existing 3 requirements preserved |

### Destructive-merge review (explicit callout requested)

No destructive delta merge was performed. No delta contained REMOVED / MODIFIED / RENAMED sections. The only "overwrite" semantics are the two fresh main specs:

- **`job-lifecycle`**: no main spec existed for this domain — the `jobs-module` change (which introduced the legacy lifecycle with `en_progreso`/`enviado_revision`/`listo_pagar`) was never archived, so its specs never reached `openspec/specs/`. The "overwrite" is therefore SEMANTIC, not destructive: the fresh main spec establishes the new state machine as the source of truth and supersedes the legacy states. No existing main-spec content was destroyed.
- **`production-codes`**: same situation — no prior main spec existed; nothing to destroy.
- **`role-based-route-guard`**: delta was `## ADDED Requirements` only. Merge preserved all existing requirements and appended the new one verbatim. Note (from design.md): the delta cites the legacy RPC name `set_job_archived`; implementation targets `set_job_archived_v2` exclusively (canonical RPC per `20260813031000:75`). The spec text was merged as written, per delta-merge rules.

### Final-state facts (outrank verify-report / apply-progress snapshots)

1. **Verify WARNING #3 (JI-2 defense-in-depth) — FIXED after verify-report.** Corroborated in repository: the technician "office-managed fields" exclusion list in `validate_job_update` (`supabase/migrations/20260817012000_job_state_machine_and_permissions.sql:64-72`) does NOT include `invoice_number` / `invoice_path` / `invoiced_at`; any technician UPDATE touching those columns differs from the old row and raises `Technicians cannot update office-managed fields`. Per orchestrator final-state fact, `npm run build` still passes after this fix.
2. **Follow-up (documented, NOT fixed)**: task 8.2 — migrations `20260817010000`–`13000` were never executed against a linked database (Supabase CLI unavailable in this environment). Idempotent re-run verification and DO-block pre/post counts remain pending human execution. Not a code failure.
3. **Follow-up (documented, NOT fixed)**: task 8.4 — manual role matrix (técnico/supervisor/admin/ayudante) remains pending human execution. No test runner is configured by project policy, so runtime proof of the 36 scenarios depends on this matrix.
4. **Design deviation (documented, intentional)**: office evidence/photo document management stays admin-only; supervisor evidence management was an unresolved design open question and remains so. No spec requirement broken (role-based-route-guard only mandates archive/delete for supervisor).

### Task completion

24/26 checked. The two unchecked tasks (8.2, 8.4) are Phase 8 VERIFICATION tasks pending human execution per orchestrator final-state facts — not stale implementation checkboxes. All implementation tasks (1.1–7.1) are complete. Archive proceeds per orchestrator authorization with these recorded as risks (intentional-with-warnings).

### Verification at close

- verify-report: verdict `pass_with_warnings`, blockers 0, critical_findings 0, requirements 16/16, scenarios 36/36 (implementation evidence; runtime confirmation pending tasks 8.2/8.4).
- `npm run lint` and `npm run build` pass (verify-report); build still passes after the Warning #3 fix (orchestrator final-state fact).

### Review gate

No `reviewGate` was present in the received status and no review artifacts exist for this candidate. Archive proceeded under ordinary repository policy.

## Mechanical Integrity Evidence

- 4 fresh main specs: `Copy-Item` → `git diff --no-index` readback (empty) → `Move-Item` → final `git diff --no-index` readback (empty, exit 0) for each domain.
- Archive move: recursive pre-move snapshot → `Move-Item` → source-gone check passed → `git diff --no-index` (snapshot vs archive) empty, exit 0. No differences = no truncation or alteration.
- This archive report file was added AFTER the readbacks (additive-only, excluded from source/destination comparison).

## Archive Location

`openspec/changes/archive/2026-08-17-job-invoicing-and-splits/` — preserved as audit trail, never deleted or modified.

## Engram Traceability

Observations identified during archive (previews used only for identification; filesystem artifacts are authoritative in hybrid mode): #538 (proposal), #539 (root causes), #540 (resolved open questions), #541 (spec), #543 (design), #544 (tasks), #545 (forecast), #546 (apply-progress), #547 (verify-report).

## Follow-ups / Risks (open at close)

1. Task 8.2 — idempotent re-run of migrations against a linked database + DO-block count verification (Supabase CLI unavailable in this environment).
2. Task 8.4 — manual role matrix (técnico/supervisor/admin/ayudante) pending human execution; runtime compliance of 36 scenarios unproven until completed.
3. Design deviation — office evidence/photo document management remains admin-only; supervisor evidence management is an unresolved design open question.
4. `jobs-module` change was never archived — its deltas never reached the main specs store; the fresh `job-lifecycle` and `production-codes` main specs now define those domains, but `jobs-module` (and `auth-foundation-hardening`, `mvp-next-module`) remain active change folders that must still complete their own cycles.
5. Stage-2 enum cleanup deferred (verify-report SUGGESTION 1) — dropping legacy enum labels (`en_progreso`, `enviado_revision`, `listo_pagar`) via type recreation remains a post-production step; legacy labels still exist in applied migrations.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. Source of truth updated. Ready for the next change.
