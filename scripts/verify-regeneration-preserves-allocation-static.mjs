import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("supabase/migrations/20260827000000_preserve_allocation_on_regeneration.sql");

// Regeneration must keep current_delivery_id on the submitted money-owning
// delivery; only a real submission (p_submit) advances it to the new delivery.
assert.match(migration, /current_delivery_id = case when p_submit then new_delivery else previous_delivery end/u,
  "regeneration must not repoint current_delivery_id away from the submitted delivery");
assert.doesNotMatch(migration, /current_delivery_id = new_delivery/u,
  "current_delivery_id must never be repointed unconditionally");
assert.match(migration, /create or replace function public\.confirm_delivered_job_pdf_complete_before_capabilities/u,
  "migration must replace the definitive delivery confirmation function");

console.log("PASS regeneration preserves allocation static checks");
