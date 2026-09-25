import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isRecruitmentId, isRecruitmentStatus, parseRecruitmentUpdate } from "./core.ts";

const id = "11111111-1111-4111-8111-111111111111";
const form = (values = {}) => {
  const data = new FormData();
  Object.entries({ id, status: "contacted", internal_notes: "  Follow up  ", updated_at: "2026-09-15T01:00:00.123456+00:00", ...values })
    .forEach(([key, value]) => data.set(key, value));
  return data;
};
test("office update preserves optimistic concurrency timestamp and trims notes", () => {
  const result = parseRecruitmentUpdate(form());
  assert.equal(result.internal_notes, "Follow up");
  assert.equal(result.updated_at, "2026-09-15T01:00:00.123456+00:00");
});
test("office update rejects invalid ids, workflow states and oversized notes", () => {
  for (const values of [{ id: "../users" }, { status: "admin" }, { internal_notes: "x".repeat(10001) }, { updated_at: "yesterday" }]) {
    assert.equal(parseRecruitmentUpdate(form(values)), null);
  }
  assert.equal(isRecruitmentId(null), false);
  assert.equal(isRecruitmentStatus("hired"), true);
});
test("migration gates submitted data, protects credentials and limits office writes", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260915010000_recruitment_applications.sql", import.meta.url), "utf8");
  assert.match(sql, /grant update \(status, internal_notes\)/);
  assert.match(sql, /alter table public\.job_applications enable row level security/);
  assert.match(sql, /revoke all on public\.job_applications from anon, authenticated/);
  assert.match(sql, /grant select on public\.job_applications to authenticated/);
  assert.match(sql, /Office staff read legacy applications[^;]+using \(public\.is_office_staff\(auth\.uid\(\)\)\)/);
  assert.doesNotMatch(sql, /(?:delete from|truncate|drop table) public\.job_applications/);
  assert.match(sql, /submission_state = 'submitted' and public\.is_office_staff\(auth\.uid\(\)\)/);
  const projection = sql.match(/grant select \(([\s\S]*?)\)\s+on public\.recruitment_applications/)[1];
  assert.doesNotMatch(projection, /submission_token_hash|submission_key|privacy_accepted_at/);
  assert.match(sql, /'recruitment-resumes', 'recruitment-resumes', false, 10485760/);
  assert.match(sql, /full_name text not null check \(char_length\(btrim\(full_name\)\) between 1 and 160\)/);
  assert.match(sql, /recruitment_pending_expiry_idx[\s\S]*?\(submission_expires_at\)\s+where submission_state = 'pending'/);
  assert.match(sql, /revoke all on function public\.consume_recruitment_rate_limit\(text\) from public, anon, authenticated/);
});
