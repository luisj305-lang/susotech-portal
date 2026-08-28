```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:fff7bcf7c2578442a5af2560c97a863680db21a47e42d1ede8244c6a2524075f
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 15/15
test_command: npm run lint
test_exit_code: 0
test_output_hash: sha256:fc96a65ed440dc77554e41d33e437b3a0a9248d9947cd4f45b989f449cbde00f
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:8a1c36b212b98a6495f45be9fa655899ca88e45f3f48e252c25e4a1c8ae3724c
```

## Verification Report

**Change**: multi-part-jobs
**Version**: N/A (delta specs carry no version marker)
**Mode**: Standard (no Strict TDD signal)

### Executive Summary

The `multi-part-jobs` change is implemented as specified. All 15 tasks are complete, `npm run lint` exits 0 (1 pre-existing warning unrelated to this change) and `npm run build` compiles cleanly (Next.js 16.3.0, TypeScript passes). Static source review confirms every locked decision is implemented correctly: nullable `parent_job_id` self-FK with `ON DELETE RESTRICT`, self-parent CHECK, a hierarchy trigger enforcing flat one-level + full `parent_job_id` immutability (`is distinct from`), and a `create_job_part` RPC that gates on office staff, clones 7 fields, sets `sin_asignar`, uses the `set_config('app.job_assignment_mutation')` token, and revokes public / grants authenticated. No CRITICAL findings. Because this environment has no Supabase CLI / psql / Docker / local Postgres, the DB-level behaviors (guards, RPC clone/gates, FK restrict, invoicing dedup) are verified at the SQL-source level only and are explicitly NOT executed — recorded as WARNING, not a code defect.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 15 |
| Tasks complete | 15 |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Build**: ✅ Passed
```text
npm run build
Next.js 16.3.0 (Turbopack) — Compiled successfully in 3.5s; TypeScript finished; 24/24 static pages generated.
Exit code 0.
```

**Tests**: ➖ No test runner configured (project config is lint + build only)
```text
npm run lint
> eslint
src/components/manual-jobs/manual-jobs-manager.tsx
  65:3  warning  'currentUserId' is defined but never used  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)
Exit code 0.
```
Note: the single lint warning is in `src/components/manual-jobs/manual-jobs-manager.tsx`, a file outside this change's affected areas — pre-existing, not introduced.

**Coverage**: ➖ Not available (no coverage runner).

### Spec Compliance Matrix

Verification is static (source inspection) + lint/build. There is no test runner, so "covering test passed at runtime" is not achievable in this project. DB-enforced scenarios are verified at the SQL-source level and are marked UNEXECUTED (no DB in this environment), not FAILING.

| Requirement | Scenario | Result |
|-------------|----------|--------|
| multi-part-jobs: Modelo de partes padre/hijo | Raíz autónoma sin hijos | ✅ COMPLIANT (static) |
| multi-part-jobs: Modelo de partes padre/hijo | Partes planas de un nivel | ⚠️ UNEXECUTED (DB) |
| multi-part-jobs: Copia de campos compartidos | Parte autocontenida | ⚠️ UNEXECUTED (DB) |
| multi-part-jobs: Guardas de integridad | Auto-padre rechazado | ⚠️ UNEXECUTED (DB) |
| multi-part-jobs: Guardas de integridad | Hijo no puede ser padre | ⚠️ UNEXECUTED (DB) |
| multi-part-jobs: Agregar otra parte | Parte creada en cualquier momento | ⚠️ UNEXECUTED (DB) |
| multi-part-jobs: Agregar otra parte | Rol no autorizado | ⚠️ UNEXECUTED (DB) |
| multi-part-jobs: Agregar otra parte | Trabajo archivado | ⚠️ UNEXECUTED (DB) |
| multi-part-jobs: Agrupación de partes en listas | Agrupación y rótulo | ⚠️ PARTIAL (static) |
| job-invoicing: Facturación independiente por parte | Pago de una parte no cierra las demás | ⚠️ UNEXECUTED (DB) |
| job-invoicing: Facturación independiente por parte | Número de factura por parte | ⚠️ UNEXECUTED (DB) |
| job-invoicing: Conteo único en totales y reportes | Deduplicación en totales | ⚠️ UNEXECUTED (DB) |
| job-lifecycle: Archivado y borrado con partes | Borrado de raíz con hijos bloqueado | ⚠️ UNEXECUTED (DB) |
| job-lifecycle: Archivado y borrado con partes | Archivar raíz no archiva hijos | ⚠️ UNEXECUTED (DB) |
| job-lifecycle: Archivado y borrado con partes | Parte bloqueada en archivados | ✅ COMPLIANT (static) |

**Compliance summary**: 15/15 scenarios implemented. 3 scenarios fully statically verified; 12 scenarios are DB-executed behaviors verified only at the SQL-source level and UNEXECUTED here (environment limitation).

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| parent_job_id nullable self-FK, ON DELETE RESTRICT | ✅ Implemented | migration L6 (add column), L8-12 (FK restrict) |
| Self-parent CHECK | ✅ Implemented | migration L16-20 `jobs_no_self_parent_check` (`parent_job_id is null or parent_job_id <> id`) |
| Only roots can be parents (flat one-level) | ✅ Implemented | migration L40-45 trigger rejects a non-root parent on INSERT |
| parent_job_id IMMUTABLE after insert | ✅ Implemented | migration L33-38: UPDATE raises when `new.parent_job_id is distinct from old.parent_job_id`; covers no re-parent, no root→part, no part→root |
| create_job_part: office-staff gate | ✅ Implemented | migration L70 `is_office_staff(actor)`; action re-checks via `requireSupervisor()` (actions L531) which admits admin+supervisor |
| create_job_part: reject missing/archived/child parent | ✅ Implemented | migration L75-77 |
| create_job_part: set_config token | ✅ Implemented | migration L79 `set_config('app.job_assignment_mutation', actor::text, true)` |
| create_job_part: clone 7 fields + sin_asignar | ✅ Implemented | migration L81-88 clones title, prism_number, address, customer_name, category, location, job_type; main_status='sin_asignar' |
| revoke public / grant authenticated | ✅ Implemented | migration L94-95 |
| Job type: parent_job_id, partLabel, JobPartGroup | ✅ Implemented | types.ts L70-71, L78-81 |
| partLabel / groupJobParts root-first | ✅ Implemented | parts.ts L12-57 |
| createJobPart action + revalidate | ✅ Implemented | actions.ts L530-539 (RPC + refresh → revalidatePath) |
| Lists do not flat double-count children | ✅ Implemented | listOfficeJobs/listTechnicianJobs return each jobs row once; grouping is UI-side (job-list.tsx L34, page.tsx L67) |
| getOfficeJob returns root + sibling parts | ✅ Implemented | queries.ts L197-209 |
| UI: part actions office + non-archived + root-only | ✅ Implemented | app/trabajos/[id]/page.tsx L104 |
| "Parte N" chip; standalone root no chip | ✅ Implemented | job-list.tsx L21, page.tsx L35, part-actions.tsx L38 |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Parent model: nullable self-FK, root = part 1, flat children | ✅ Yes | migration + parts.ts |
| Shared fields copied at creation (self-contained child) | ✅ Yes | 7-field clone (superset of the 5 spec-listed fields) |
| Hierarchy guards in DB (CHECK + trigger + FK RESTRICT) | ✅ Yes | migration |
| job_stages left dormant | ✅ Yes | untouched |
| RPC security definer + office gate | ✅ Yes | migration L61-62, L70 |
| Aggregation dedup: no rewrite needed | ✅ Yes | get_weekly_invoiced_total already `count(distinct d.job_id)` (20260820002000 L26) |

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. **DB assertions not executed (no DB in environment)** — tasks.md 4.2 and 4.3; specs multi-part-jobs "Guardas de integridad" / "Agregar otra parte" / "Copia de campos compartidos", job-lifecycle "Archivado y borrado con partes", job-invoicing "Facturación independiente" / "Conteo único". The 12 DB-enforced scenarios were verified at the SQL-source level only. No Supabase CLI / psql / Docker / local Postgres is available here, so no SQL was executed. Reported as unexecuted, not as a code defect.
2. **Technician list "Parte N" label is lost when the root is not RLS-visible** — multi-part-jobs spec "Agrupación de partes en listas" / scenario "Agrupación y rótulo". `groupJobParts` (parts.ts L53-57) preserves a child whose root is absent from the list as a standalone group but calls `withLabel(job, [])`, so `partLabel` returns null for that child. A technician assigned to a part whose root is assigned elsewhere sees the part but with no "Parte N" chip, and multiple such siblings render as separate unlabeled groups. Functional work is unaffected (the child is self-contained); this is a labeling/grouping degradation in the technician list, where the office list is fully correct.

**SUGGESTION**:
1. **Map the FK-RESTRICT delete error to a clear message** — job-lifecycle "Borrado de raíz con hijos bloqueado". `deleteArchivedJob` (actions.ts L316-342) collapses the FK violation from `delete_archived_job` into the generic "No se pudo eliminar permanentemente el trabajo." Consider a specific Spanish message ("Este trabajo tiene partes y no se puede eliminar."), analogous to the `mapCreateJobPartError` pattern (actions.ts L521-528).
2. **Close stale design open questions** — design.md still lists two open questions (parent_job_id immutability; clone location/job_type) that tasks.md 1.3/1.4 and the implementation have already resolved. Update design.md to avoid ambiguity at archive time.
3. **Document the 7-field clone in the delta spec** — multi-part-jobs spec "Copia de campos compartidos" lists 5 fields (cliente/domicilio/PRISM/título/categoría) but the locked decision and implementation clone 7 (adds `location`, `job_type`). Record the 7-field clone in the delta spec during archive so spec and behavior match exactly.
4. **Clean up the pre-existing lint warning** — `src/components/manual-jobs/manual-jobs-manager.tsx:65` unused `currentUserId`. Unrelated to this change; fix separately.

### Verdict

**PASS WITH WARNINGS**

Implementation is complete and statically correct against proposal, specs, design, and tasks; lint and build are green. The two WARNINGs are (1) the environment-level inability to execute DB assertions (not a code defect) and (2) a partial technician-list labeling gap for the root-not-visible case.

### DB assertions not executed (no DB in env)

The following DB assertions from tasks.md 4.2/4.3 were **NOT executed** — no Supabase CLI, psql, Docker, or local Postgres is available in this environment, and no SQL was run against any database:

- Self-parent rejected (CHECK `jobs_no_self_parent_check`)
- Child-as-parent rejected (trigger `validate_job_parent_hierarchy`)
- UPDATE of `parent_job_id` rejected (immutability branch)
- Delete root-with-children rejected (FK `on delete restrict`)
- `create_job_part` clones 7 fields / rejects non-office / archived / child parent
- Invoicing dedup: root + 2 children `pagado` → `get_weekly_invoiced_total` counts 3

These are marked UNEXECUTED in the compliance matrix above. They are not claimed as passed or failed.
