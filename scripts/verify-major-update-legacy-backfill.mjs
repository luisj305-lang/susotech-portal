import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const mode = process.argv[2];
assert.ok(mode === "seed" || mode === "verify", "Usage: seed | verify");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && anonKey && serviceKey, "Local Supabase environment required");
assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "Refusing non-local Supabase");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const service = createClient(url, serviceKey, options);
const fixturePath = new URL("../tmp/legacy-backfill-fixture.json", import.meta.url);

if (mode === "seed") {
  const password = "LegacyBackfill9!Safe";
  async function seededActor(role) {
    const email = `legacy-backfill-${role}-${randomUUID()}@example.com`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const id = created.data.user.id;
    assert.ifError((await service.from("profiles").update({ role, is_active: true, full_name: `Legacy ${role}` }).eq("id", id)).error);
    return { id, email, password };
  }
  const admin = await seededActor("admin");
  const technician = await seededActor("tecnico");
  const jobId = randomUUID();
  const productionId = randomUUID();
  const deliveredPath = `${jobId}/delivered/${randomUUID()}.pdf`;
  const delivered = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
  assert.ifError((await service.storage.from("project-files").upload(deliveredPath, delivered, { contentType: "application/pdf" })).error);
  assert.ifError((await service.from("jobs").insert({
    id: jobId, title: "Legacy delivery backfill", main_status: "enviado_revision",
    delivered_pdf_path: deliveredPath, delivered_pdf_generated_by: admin.id,
    delivered_pdf_generated_at: new Date().toISOString(),
  })).error);
  assert.ifError((await service.from("job_status_history").insert({
    job_id: jobId, previous_status: "en_progreso", new_status: "enviado_revision",
    changed_by: technician.id, notes: "Legacy final submitter",
  })).error);
  assert.ifError((await service.from("job_production_codes").insert({
    id: productionId, job_id: jobId, code: "LEGACY", quantity: "12.345",
    added_by: technician.id, credited_technician_id: technician.id,
    technician_type_snapshot: "in_house", unit_snapshot: "foot",
    unit_rate_snapshot: "0.2", amount_snapshot: "2.47",
    production_date: new Date().toISOString().slice(0, 10),
  })).error);
  mkdirSync(new URL("../tmp", import.meta.url), { recursive: true });
  writeFileSync(fixturePath, JSON.stringify({ admin, technician, jobId, productionId, deliveredPath }));
  console.log(JSON.stringify({ result: "SEEDED", jobId }));
} else {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const delivery = await service.from("job_deliveries")
    .select("id,delivered_by,submitted,superseded_at")
    .eq("job_id", fixture.jobId).single();
  assert.ifError(delivery.error);
  assert.equal(delivery.data.delivered_by, fixture.technician.id);
  assert.equal(delivery.data.submitted, true);
  assert.equal(delivery.data.superseded_at, null);
  const line = await service.from("job_delivery_production_lines")
    .select("source_annotation_id,legacy_production_code_id,credited_technician_id,quantity")
    .eq("delivery_id", delivery.data.id).single();
  assert.ifError(line.error);
  assert.equal(line.data.source_annotation_id, null);
  assert.equal(line.data.legacy_production_code_id, fixture.productionId);
  assert.equal(line.data.credited_technician_id, fixture.technician.id);
  assert.equal(Number(line.data.quantity), 12.345);
  const admin = createClient(url, anonKey, options);
  assert.ifError((await admin.auth.signInWithPassword({ email: fixture.admin.email, password: fixture.admin.password })).error);
  const dashboard = await admin.rpc("get_worker_operations_dashboard", { p_reference_at: new Date().toISOString() });
  assert.ifError(dashboard.error);
  const row = dashboard.data.find((item) => item.technician_id === fixture.technician.id);
  assert.equal(Number(row.weekly_production), 12.345);
  assert.equal(Number(row.weekly_delivered_jobs), 1);
  console.log(JSON.stringify({ result: "PASS", production: 12.345, deliveredJobs: 1 }));
}
