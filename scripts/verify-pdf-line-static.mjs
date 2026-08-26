import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const core = read("src/lib/jobs/pdf-line-core.ts");
const sql = read("supabase/migrations/20260825010000_pdf_line_annotations.sql");
const editor = read("src/components/jobs/pdf-code-editor.tsx");
const actions = read("src/lib/jobs/actions.ts");
const route = read("app/api/trabajos/[id]/pdf-entregado/route.ts");
const compositor = read("src/lib/jobs/delivered-pdf.ts");

// Core: decorative polyline model without billing fields.
assert.match(core, /maxLines: 100/u);
assert.match(core, /minPoints: 2/u);
assert.match(core, /maxPoints: 50/u);
assert.match(core, /simplifyLine/u);
assert.match(core, /structuredClone/u);
assert.match(core, /CODE_COLOR_OPTIONS/u);

// Migration: additive v4 contract mirroring the text-note pipeline.
assert.match(sql, /add column if not exists lines jsonb not null default '\[\]'::jsonb/u);
assert.match(sql, /create or replace function public\.validate_job_pdf_lines/u);
assert.match(sql, /create or replace function public\.initialize_job_pdf_draft_v4/u);
assert.match(sql, /create or replace function public\.save_job_pdf_draft_v4/u);
assert.match(sql, /jsonb_array_length\(p_lines\) > 100/u);
assert.match(sql, /jsonb_array_length\(item->'points'\) < 2/u);
assert.match(sql, /Invalid PDF line page lineage/u);
assert.match(sql, /revoke all on function public\.save_job_pdf_draft_v4/u);

// Editor: free-hand draw tool + line rendering + color/selection.
for (const token of ["tool === \"line\"", "onCommitLine", "simplifyLine", "onMoveLine", "touch-none", "Línea", "LineColorPicker"])
  assert.ok(editor.includes(token), `editor missing ${token}`);

// Server wiring: save v4, validate lines, pass lines to the compositor.
assert.ok(actions.includes("validatePdfLines"), "actions must validate lines");
assert.ok(actions.includes("p_lines: input.lines"), "actions must persist lines");
assert.ok(route.includes("validatePdfLines"), "route must validate lines");
assert.ok(route.includes("lines.map(({ page, points, color }) => ({ page, points, color }))"), "route must pass lines to compositor");
assert.ok(compositor.includes("for (const line of lines.filter"), "compositor must render lines");

console.log("[pdf-line-static] PASS");
