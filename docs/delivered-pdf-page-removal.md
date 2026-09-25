# Delivered PDF page removal: local completion manifest

Office administrators and supervisors can remove complete pages from the current delivered PDF using revision-bound thumbnails. This includes source-document and photo-evidence pages. At least one page must remain. Only non-archived jobs in `asignado` or `en_revision` are eligible.

## Behavior and safety boundary

- Removal edits the rendered PDF, not production codes, totals, allocations, `current_delivery_id`, source documents, or gallery photos. Source-input snapshots remain unchanged, so intentional removal does not falsely mark the PDF stale.
- Refresh preserves the trimmed PDF. Repeated removals operate on its current page numbers. Stale selections return a conflict rather than applying to a newer PDF.
- Regeneration and technician resubmission explicitly warn that current source documents/photos restore the removed pages. Canceling keeps the current PDF. This is not persistent source-page exclusion or a full-editor change.
- A database trigger rejects replacement of a newly trimmed PDF unless the uploaded replacement is bound to that exact path and explicitly confirmed (or is another page removal). This covers regeneration that began before removal and legacy confirmation RPCs without replacement metadata.
- Removal retains previous PDFs and uncertain uploads. This avoids deleting a successfully committed PDF after a transport failure, at the cost of additional private storage. There is no new retention-cleanup job or user-facing undo feature.
- Page removal is not secure redaction: PDF internals, retained historical files, and gallery/source files may still contain removed content.

## Feature-only touched-file manifest

All paths below belong to this bounded local work unit. Files marked **shared** were already dirty before this work; their entire Git diff is NOT the feature patch.

| Path | This unit's change | Baseline |
|---|---|---|
| `src/lib/jobs/delivered-pdf.ts` | Strict page validation, 130-page ceiling, 480px thumbnail raster cap | **Shared:** existing original-PDF flattening/refactoring retained |
| `src/lib/jobs/delivered-pdf-replacement.ts` | Explicit replacement challenge/confirmation client helper | New |
| `src/components/jobs/delivered-pdf-page-remover.tsx` | Revision-bound thumbnails/submission, minimum-page and pending guards, neutral Spanish warning/reload UX | Tracked feature in `a043b69`, previously clean |
| `src/components/jobs/job-documents.tsx` | Confirmed regeneration helper and accurate trim/restoration copy | **Shared:** existing compatible/mobile PDF viewer changes retained |
| `src/components/jobs/pdf-code-editor.tsx` | Confirmed resubmission helper and request error cleanup only | **Shared:** existing percentage-allocation/editor changes retained |
| `app/trabajos/[id]/page.tsx` | Hide removal for archived jobs; pass current PDF path | **Shared:** existing financial-allocation editor integration retained |
| `app/api/trabajos/[id]/pdf-entregado/miniatura/route.ts` | Office/status/archive/revision checks before private download | Tracked feature in `a043b69`, previously clean |
| `app/api/trabajos/[id]/pdf-entregado/quitar-paginas/route.ts` | Strict request validation, revision guard, unchanged source snapshots, recoverable RPC ambiguity, storage revision metadata | Tracked feature in `a043b69`, previously clean |
| `app/api/trabajos/[id]/pdf-entregado/route.ts` | Replacement confirmation challenge, archive check, expected-path upload metadata, conflict message | **Shared:** existing source download verification and allocation changes retained |
| `supabase/migrations/20260914020000_harden_delivered_pdf_page_removal.sql` | Replace removal RPC implementation; add trimmed-PDF replacement guard trigger | New additive migration |
| `scripts/verify-delivered-pdf-removal.mjs` | Real PDF rendering/removal, stubbed route/auth/storage tests, feature-scoped TypeScript check | New |
| `scripts/verify-delivered-pdf-removal-sql.mjs` | Real PostgreSQL function/trigger checks in a disposable in-memory fixture | New |
| `docs/delivered-pdf-page-removal.md` | This manifest, behavior, migration/deployment/rollback boundary | New |

Unchanged prerequisite: `supabase/migrations/20260914010000_remove_delivered_pdf_pages.sql` is already tracked in `a043b69`; it was not edited. No unrelated hourly/fleet/payroll changes were authored here. Recruitment and `prueba/` are excluded and must not enter a feature-only deployment.

## Verification commands

Run source-mutating normalization before final verification. The runtime scripts read only fixture/source data and never connect to production.

```powershell
node scripts/verify-delivered-pdf-removal.mjs
node scripts/verify-delivered-pdf-removal-sql.mjs "C:\Users\BRYANJ~1\AppData\Local\Temp\opencode\pdf-removal-sql-tools\node_modules\@electric-sql\pglite\dist\index.js"
node scripts/verify-delivered-pdf-removal.mjs --typecheck
```

Final local results: runtime **PASS (95 checks)**, SQL **PASS (28 checks)**, scoped TypeScript **PASS (0 diagnostics)**. Targeted ESLint normalization completed before the final checks; the final read-only lint passed with zero warnings:

```powershell
npx eslint --max-warnings 0 "src/lib/jobs/delivered-pdf.ts" "src/lib/jobs/delivered-pdf-replacement.ts" "src/components/jobs/delivered-pdf-page-remover.tsx" "src/components/jobs/job-documents.tsx" "src/components/jobs/pdf-code-editor.tsx" "app/trabajos/[id]/page.tsx" "app/api/trabajos/[id]/pdf-entregado/route.ts" "app/api/trabajos/[id]/pdf-entregado/miniatura/route.ts" "app/api/trabajos/[id]/pdf-entregado/quitar-paginas/route.ts" "scripts/verify-delivered-pdf-removal.mjs" "scripts/verify-delivered-pdf-removal-sql.mjs"
```

PGlite is test-only tooling installed outside the repository with `npm install --prefix "C:\Users\BRYANJ~1\AppData\Local\Temp\opencode\pdf-removal-sql-tools" --no-audit --no-fund --ignore-scripts @electric-sql/pglite`. It is not an application dependency. The SQL harness runs the actual removal RPC, office-role helper, current local job-update trigger and new replacement guard against a minimal synthetic schema. It does not prove the complete production schema, Storage RLS, or parallel-connection scheduling.

The TypeScript mode compiles the nine feature TS/TSX roots plus dependencies using project settings, without incremental output. It refuses protected recruitment/`prueba` source reads. A full production build and browser desktop/mobile/keyboard acceptance are separate verification steps.

## Migration and deployment gate

1. The parent preflight must establish the deployed baseline and whether `20260914010000` has already run. Do not infer deployed state from local Git tracking.
2. Apply the original migration only if missing, followed by `20260914020000`. No existing signature changes: `remove_delivered_pdf_pages(uuid, text, text, uuid[])` remains. No new columns or financial recalculation/backfill.
3. Coordinate the additive migration with deployment of the nine runtime files above. The hardened RPC rejects old uploads without revision/actor metadata; new removal code against the original-only RPC lacks the SQL object/replacement safeguards. Reload old clients.
4. Build an isolated artifact from the verified deployed baseline plus only this unit's changes. Do not deploy this dirty workspace wholesale; shared files contain unrelated pre-existing work. Include existing `public/pdfium.wasm` and the PDFium/pdf-lib/sharp runtime packaging already required by generation.
5. Existing pre-hardening trims have no `operation=page-removal` marker and may have already reduced photo snapshots. They are not automatically repaired. The new UI still warns before regeneration; a historical snapshot repair requires a separate evidence-backed decision.

No production access, real database migration, deployment, stage, commit, or push was performed by this unit.

## Rollback boundary

Disable the page-removal UI/endpoint first. Keep the hardened database guard while investigating; rolling application code back to the original feature while leaving its endpoint enabled causes incompatible upload metadata. Remove/revert only the feature hunks and newly added helper/tests/docs listed above, never whole shared files. A database rollback must be an explicit forward migration and coordinated with compatible application code; no destructive rollback script is supplied.

Existing delivered pointers and financial identities are not rolled back automatically. Prior PDFs retained by new removals can support an authorized recovery, but old implementations may already have deleted earlier objects. Do not bulk-reset snapshots or delete retained objects as part of code rollback.
