```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:2e907792300a29a0987fddcd90c23690340180f67807738811e8f2372c7e0c51
verdict: pass
blockers: 0
critical_findings: 0
requirements: 26/26
scenarios: 53/53
test_command: 'cmd /d /c "node scripts/verify-job-domain.mjs && node scripts/verify-jobs-rls.mjs && node scripts/verify-job-assignment-rpc.mjs && node scripts/verify-jobs-final.mjs && node scripts/verify-job-actions-runtime.mjs && node scripts/verify-bulk-import-ui.mjs && npm run lint && npx tsc --noEmit && npm run build && node scripts/verify-job-routes-runtime.mjs"'
test_exit_code: 0
test_output_hash: sha256:8747e424dc24143d7c7e8871ddc4d3e83438fd41d56630c132a225ea19c55d3a
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:332033e33c511d16ca2c11c0b2493596e2ddbfbe1267986159ed1d52055d8483
```

## Verification Report

**Change**: jobs-module
**Version**: N/A
**Mode**: Standard

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 51 |
| Tasks complete | 51 |
| Tasks incomplete | 0 |

All 51 task checkboxes were compared with implementation and current runtime evidence. The ten specifications contain 26 requirements and 53 scenarios.

### Build & Tests Execution

**Build**: ✅ Passed

```text
npm run build
Exit 0. Next.js 16.3.0 compiled successfully, completed TypeScript validation, generated 12 static pages, and emitted all expected dynamic job routes.
Output SHA-256: 332033e33c511d16ca2c11c0b2493596e2ddbfbe1267986159ed1d52055d8483
```

**Tests**: ✅ 7 runtime harnesses passed; lint, TypeScript, and build passed

```text
[jobs-domain] PASS transitions=18 state=7 types=10 guards=4 actions=8 storage=4 rpc=2 office=14 bulk_ui=15 technician_ui=25
[jobs-rls] PASS checks=77 cleanup=passed users=6 jobs=3 crews=1 objects=2
[jobs-assignment-rpc] PASS checks=51 cleanup=passed users=4 jobs=3 crews=1
[jobs-final] PASS checks=113 cleanup=passed users=5 jobs=8 crews=1 objects=3
[jobs-actions-runtime] PASS checks=49 cleanup=passed users=3 jobs=2 objects=3
[bulk-import-ui] PASS checks=10 rows=2 retry_targets=1
[jobs-routes-runtime] PASS checks=43 server=stopped cleanup=passed users=4 jobs=4 crews=1 objects=1
npm run lint: exit 0
npx tsc --noEmit: exit 0
npm run build: exit 0
Output SHA-256: 8747e424dc24143d7c7e8871ddc4d3e83438fd41d56630c132a225ea19c55d3a
```

Live Supabase business operations use authenticated role clients. `service_role` remains confined to server-side fixture setup and `finally` cleanup. The route harness starts the compiled application on an ephemeral loopback port and reports `server=stopped` after completion.

**Coverage**: ➖ Not available; the project has no coverage runner or threshold.

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Bulk assignment / Individual or bulk | Bulk assignment to crew | `verify-jobs-final.mjs` assigns two jobs to a crew and proves lead/member visibility | ✅ COMPLIANT |
| Bulk assignment / Individual or bulk | Ambiguous assignee | `verify-jobs-final.mjs` rejects a row containing technician and crew simultaneously | ✅ COMPLIANT |
| Bulk assignment / Coherent reassignment | Individual reassignment | `verify-job-assignment-rpc.mjs` preserves the inactive prior row and one active primary | ✅ COMPLIANT |
| Bulk assignment / Coherent reassignment | Batch failure | `verify-job-assignment-rpc.mjs` rejects a mixed valid/invalid batch and proves rollback | ✅ COMPLIANT |
| Bulk assignment / Authorization | Technician tries to reassign | `verify-job-assignment-rpc.mjs` denies the authenticated technician RPC | ✅ COMPLIANT |
| Bulk PDF import / Multiple import | Multiple valid PDFs | `verify-job-actions-runtime.mjs` executes `importProjectPdfs`, stores two private PDFs, and verifies defaults | ✅ COMPLIANT |
| Bulk PDF import / Multiple import | Non-PDF file | `verify-job-actions-runtime.mjs` returns an isolated per-file failure and creates no invalid job | ✅ COMPLIANT |
| Bulk PDF import / Recoverable result | Partial result | `verify-bulk-import-ui.mjs` executes the shared product model, renders mixed outcomes, retries only failure, and preserves unique successes | ✅ COMPLIANT |
| Bulk PDF import / Recoverable result | Search by PDF name | `verify-job-routes-runtime.mjs` imports through the real core and requests authenticated `/trabajos?q=<filename>` | ✅ COMPLIANT |
| Crew management / Crew administration | Office creates a crew | `verify-jobs-final.mjs` creates an active crew with a valid lead | ✅ COMPLIANT |
| Crew management / Crew administration | Invalid lead | `verify-jobs-final.mjs` rejects inactive and non-technician leads | ✅ COMPLIANT |
| Crew management / Unique membership | Add member | `verify-jobs-final.mjs` explicitly adds an active technician and reads the membership | ✅ COMPLIANT |
| Crew management / Unique membership | Duplicate member | `verify-jobs-final.mjs` rejects the duplicate primary-key pair | ✅ COMPLIANT |
| Crew management / Crew visibility | Technician queries own crew | Lead and member authenticated clients read their crew and membership | ✅ COMPLIANT |
| Crew management / Crew visibility | Technician queries foreign crew | An outsider receives zero rows for crew and membership queries | ✅ COMPLIANT |
| Incident tracking / Separate incident | Technician reports blockage | `verify-jobs-final.mjs` persists `no_access` while retaining `en_progreso` | ✅ COMPLIANT |
| Incident tracking / Separate incident | Combined change | `verify-job-domain.mjs` executes the real state module and rejects combined changes for both roles | ✅ COMPLIANT |
| Incident tracking / Audit | Technician resolves own incident | `verify-jobs-final.mjs` clears the incident, preserves status, and verifies history | ✅ COMPLIANT |
| Incident tracking / Audit | Technician modifies foreign job | `verify-jobs-final.mjs` denies the mutation and proves history count is unchanged | ✅ COMPLIANT |
| Job evidence / Private storage | Authorized actor requests PDF | `verify-job-actions-runtime.mjs` executes `authorizeDownload` and returns a 60-second signed URL | ✅ COMPLIANT |
| Job evidence / Private storage | Foreign actor requests evidence | Real PDF and photo signed-download authorization denies the foreign technician | ✅ COMPLIANT |
| Job evidence / Photographic evidence | Valid photo | Real signed-token upload and `confirmPhotoEvidence` produce one attributed metadata row | ✅ COMPLIANT |
| Job evidence / Photographic evidence | Unsupported file | Real photo preparation rejects invalid MIME and oversized input without metadata | ✅ COMPLIANT |
| Job evidence / Failure consistency | Interrupted upload | Real unconfirmed upload is rejected, retry succeeds idempotently, and rendered feedback retains context | ✅ COMPLIANT |
| Job lifecycle / Office create and edit | Office creates valid job | Live office creation verifies default category and status | ✅ COMPLIANT |
| Job lifecycle / Office create and edit | Unauthorized role creates or edits | Live technician update of an office-managed field is denied and unchanged | ✅ COMPLIANT |
| Job lifecycle / State machine | Technician advances own job | Live assigned technician advances through start and submission | ✅ COMPLIANT |
| Job lifecycle / State machine | Invalid transition | Live assigned-to-approved attempt is rejected and state/history remain coherent | ✅ COMPLIANT |
| Job lifecycle / State machine | Office returns for correction | Live return requires a reason and verifies supervisor, status, and audited notes | ✅ COMPLIANT |
| Job lifecycle / Auditable history | Successful change is recorded | Live workflow proves one attributable event per successful lifecycle transition | ✅ COMPLIANT |
| Job lifecycle / Auditable history | Rejected change creates no event | Invalid transitions precede exact history assertions and create no extra event | ✅ COMPLIANT |
| Production codes / Code and quantity | Technician records valid quantity | Live assigned technician inserts a positive attributed code in `en_progreso` | ✅ COMPLIANT |
| Production codes / Code and quantity | Invalid quantity | Live zero-quantity insert is rejected by the deployed constraint | ✅ COMPLIANT |
| Production codes / Scoped access | Authorized query | `verify-jobs-final.mjs` reads the attributed code with the assigned technician client | ✅ COMPLIANT |
| Production codes / Scoped access | Foreign job write | Live foreign technician code insertion is denied | ✅ COMPLIANT |
| Profile RLS / Assigned jobs | Technician reads direct job | `verify-jobs-rls.mjs` returns the directly assigned row | ✅ COMPLIANT |
| Profile RLS / Assigned jobs | Technician reads foreign job | Live foreign read returns no row | ✅ COMPLIANT |
| Profile RLS / Assigned jobs | Inactive user keeps session | Live inactive authenticated client receives no jobs | ✅ COMPLIANT |
| Profile RLS / Job resources | Technician adds own evidence | Live object upload and metadata insertion succeed | ✅ COMPLIANT |
| Profile RLS / Job resources | Technician adds foreign code | Live foreign code insertion is denied | ✅ COMPLIANT |
| Profile RLS / Job resources | Technician tries to reassign | Live assignment update and RPC attempts are denied | ✅ COMPLIANT |
| Profile RLS / Verifiable cases | Minimum RLS suite | 77-check suite covers office, assigned, foreign, inactive, anonymous, and forbidden-field cases | ✅ COMPLIANT |
| Route guard / Active role | Admin accesses users | `verify-job-routes-runtime.mjs` renders `/usuarios` with an admin SSR session | ✅ COMPLIANT |
| Route guard / Active role | Technician cannot access users | Authenticated HTTP response signals access-denied navigation and omits protected UI | ✅ COMPLIANT |
| Route guard / Active role | Supervisor accesses job management | Authenticated supervisor renders `/trabajos/nuevo` through `requireRole` | ✅ COMPLIANT |
| Route guard / Active role | Technician cannot access office management | Authenticated technician receives access-denied navigation from `/trabajos/importar` | ✅ COMPLIANT |
| Route guard / Supported roles | Supervisor accesses allowed route | Authenticated supervisor renders the office jobs view | ✅ COMPLIANT |
| Route guard / Supported roles | Technician accesses field view | Authenticated technician renders field UI without office controls | ✅ COMPLIANT |
| Technician field view / Assigned list | Technician has mixed assignments | Real route renders direct and crew jobs while excluding the foreign title | ✅ COMPLIANT |
| Technician field view / Assigned list | Technician has no jobs | Real route renders the understandable empty state for an unassigned technician | ✅ COMPLIANT |
| Technician field view / Mobile detail | Technician executes own job | Real detail renders native start/incident/code/photo controls and live database transition succeeds | ✅ COMPLIANT |
| Technician field view / Mobile detail | Technician opens foreign job | Real route renders not-found and omits the protected title | ✅ COMPLIANT |
| Technician field view / Recoverable errors | Temporary network failure | Real interrupted evidence flow plus rendered status/retry context preserves the pending filename | ✅ COMPLIANT |

**Compliance summary**: 53/53 scenarios compliant.

### Correctness (Static Evidence)

| Requirement group | Status | Notes |
|-------------------|--------|-------|
| Job lifecycle | ✅ Implemented | State actions, database trigger, timestamps, required correction reason, and history align. |
| Crew management | ✅ Implemented | Lead/member validation, uniqueness, membership trigger, and scoped RLS align. |
| Technician field view | ✅ Implemented | Role-aware pages, mobile controls, not-found behavior, and recoverable feedback align. |
| Production codes | ✅ Implemented | Positive quantity validation, compatible-state RLS, attribution, and scoped reads align. |
| Job evidence | ✅ Implemented | Private buckets, signed authorization, validation, confirmation, and idempotent retry align. |
| Incident tracking | ✅ Implemented | Orthogonal state logic, authorization, and audit align. |
| Bulk PDF import | ✅ Implemented | Action core, shared result model, retry semantics, and authenticated listing search align. |
| Bulk assignment | ✅ Implemented | Atomic assignment, one-primary invariant, history, crew visibility, and authorization align. |
| Profile RLS hardening | ✅ Implemented | All seven scenarios have live role-client evidence. |
| Role-based route guard | ✅ Implemented | All six scenarios execute against the compiled authenticated Next runtime. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Separate main status and incident | ✅ Yes | Separate columns, validation, and history remain present. |
| Unified typed assignments | ✅ Yes | Typed assignment rows plus one-active-primary invariant and atomic RPC remain present. |
| Crew with explicit lead | ✅ Yes | Lead validation and automatic membership remain present. |
| Explicit status history | ✅ Yes | Append-only user-facing policies and automatic trigger remain present. |
| Mobile-first technician view | ✅ Yes | Large controls and field-focused rendered pages remain present. |
| Private Storage | ✅ Yes | Both buckets are private and job-scoped authorization uses signed access. |
| Server actions for writes | ✅ Yes | Server actions retain guards and delegate to runtime-tested cores. |

### Issues Found

**CRITICAL**: None.

**WARNING**:

1. Physical mobile camera invocation remains a manual device smoke check; the functional file-upload path is automated.
2. Responsive appearance and visual ergonomics still require a real-device/browser visual smoke check.
3. Next.js 16 streams some redirect/not-found signals inside HTTP 200 documents; the route harness asserts navigation/fallback signals and protected-content absence.
4. No coverage percentage or threshold is configured.

**SUGGESTION**: None required for specification compliance.

### Verdict

PASS

All 26 requirements and all 53 scenarios have passing runtime evidence. Tasks, design coherence, lint, TypeScript, production build, authenticated routes, fixture cleanup, and server cleanup are complete. Manual visual/device smoke checks remain non-blocking operational warnings.
