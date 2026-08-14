import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20260813042000_pdf_text_note_primitives.sql", import.meta.url), "utf8");
const core = readFileSync(new URL("../src/lib/jobs/pdf-text-note-core.ts", import.meta.url), "utf8");

assert.match(sql, /add column if not exists text_notes jsonb not null default '\[\]'::jsonb/u);
assert.match(sql, /add column if not exists text_note_snapshot jsonb not null default '\[\]'::jsonb/u);
assert.match(sql, /create table if not exists public\.job_pdf_text_annotations/u);
assert.match(sql, /using \(public\.can_view_job\(job_id\)\)/u);
assert.match(sql, /revoke insert, update, delete on public\.job_pdf_text_annotations from authenticated/u);
assert.match(sql, /jsonb_array_length\(p_text_notes\) > 100/u);
assert.match(sql, /char_length\(note_text\) not between 1 and 2000/u);
assert.match(sql, /octet_length\(note_text\) > 8000/u);
assert.match(sql, /regexp_replace\(note_text, E'\\n', '', 'g'\) ~ '\[\[:cntrl:\]\]'/u);
assert.match(sql, /not between 0\.08 and 0\.80/u);
assert.match(sql, /not between 0\.04 and 0\.60/u);
assert.match(sql, /not between 0\.012 and 0\.05/u);
assert.match(sql, /Invalid PDF text note page lineage/u);
assert.match(sql, /create or replace function public\.initialize_job_pdf_draft_v3/u);
assert.match(sql, /create or replace function public\.save_job_pdf_draft_v3/u);
assert.match(sql, /create or replace function public\.confirm_delivered_job_pdf_complete_v3/u);
assert.match(sql, /if not public\.can_mutate_job\(p_job_id, auth\.uid\(\)\)/u);
assert.doesNotMatch(sql, /insert into public\.job_delivery_production_lines/u);
assert.match(core, /maxNotes: 100/u);
assert.match(core, /structuredClone/u);
console.log("[pdf-text-note-static] PASS");
