import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const editor = read("src/components/jobs/pdf-code-editor.tsx");
const actions = read("src/lib/jobs/actions.ts");
const route = read("app/api/trabajos/[id]/pdf-entregado/route.ts");
const compositor = read("src/lib/jobs/delivered-pdf.ts");
const page = read("app/trabajos/[id]/entregar/page.tsx");
const preview = read("app/api/trabajos/[id]/pdf-original-preview/route.ts");
const hardening = read("supabase/migrations/20260813044000_pdf_text_note_confirmation_hardening.sql");
const ambiguityFix = read("supabase/migrations/20260813046000_pdf_text_note_confirmation_ambiguity_fix.sql");
const noteKeyValidationFix = read("supabase/migrations/20260820008000_fix_pdf_text_note_key_validation.sql");

for (const token of ["textarea", "note-resize", "onMoveNote", "onResizeNote", "touch-pan-y", "onPointerCancel", "onLostPointerCapture", "fontSizeRatio", "textNotes: persistedNotes"])
  assert.ok(editor.includes(token), `editor missing ${token}`);
assert.ok(actions.includes('rpc("save_job_pdf_draft_v4"'), "draft save must use v4");
assert.ok(page.includes('rpc("initialize_job_pdf_draft_v4"'), "delivery page must initialize v4");
assert.ok(preview.includes('rpc("initialize_job_pdf_draft_v3"'), "preview must initialize v3");
for (const token of ["placements,text_notes", "validatePdfTextNotes", "text_note_snapshot_hash", "confirm_delivered_job_pdf_with_allocations_v3", "confirm_delivered_job_pdf_complete_v3", "p_text_note_snapshot: textNotes"])
  assert.ok(route.includes(token), `delivery route missing ${token}`);
const noteLayer = compositor.indexOf("for (const note of textNotes.filter");
const codeLayer = compositor.indexOf("for (const placement of codes.filter");
assert.ok(noteLayer > 0 && noteLayer < codeLayer, "notes must render before arrows and production codes");
assert.ok(compositor.includes("assertWinAnsiText(line, noteFont)"));
assert.ok(!compositor.slice(noteLayer, codeLayer).includes("asciiText("), "note text must not be transliterated");
for (const token of ["p_submit and not public.is_operational_worker", "stored_snapshot <> '[]'::jsonb", "annotation_count > 0", "annotation_count <> expected_annotation_count"])
  assert.ok(hardening.includes(token), `hardening migration missing ${token}`);
for (const token of ["deliveries.id = confirmed.delivery_id", "annotations.delivery_id = confirmed.delivery_id", "notes.value"])
  assert.ok(ambiguityFix.includes(token), `ambiguity fix missing ${token}`);
assert.match(noteKeyValidationFix, /from jsonb_object_keys\(item\) as note_keys\(note_key\)\s+where note_key not in/u);
assert.doesNotMatch(noteKeyValidationFix, /from jsonb_object_keys\(item\)\s+where value not in/u);
for (const token of ["'arrowTipX'", "'arrowTipY'"])
  assert.ok(noteKeyValidationFix.includes(token), `note key validation fix missing ${token}`);

console.log("[pdf-text-note-integration-static] PASS");
