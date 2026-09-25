import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";

// This script writes two synthetic applications and removes only its own fixtures.
// Run only after explicit authorization: node scripts/verify-recruitment-live.mjs --run-production
if (!process.argv.includes("--run-production")) {
  console.error("Production verification requires --run-production after authorization.");
  process.exit(1);
}

const API = "https://portal.susotech.org/api/public/applications";
const ORIGIN = "https://susotech.org";
const HOST = "xpazdehqzfkabangdehu.supabase.co";
const BUCKET = "recruitment-resumes";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fixtures = ["no-cv", "cv"].map(kind => ({
  key: randomUUID(), token: randomBytes(32).toString("hex"), id: null,
  email: `recruitment-test-${kind}-${randomUUID()}@example.com`, kind,
}));
const results = [];
let service;
let stage = "configuration";
let failed = false;
const cleanupFailures = [];

async function post(path, body, expected) {
  const response = await fetch(`${API}${path}`, {
    method: "POST", redirect: "error", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.status, expected);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

function payload(fixture, resume = null) {
  return {
    application: {
      fullName: `SYNTHETIC RECRUITMENT TEST ${fixture.kind}`, phone: "2025550147", email: fixture.email,
      city: "Orlando", state: "Florida", postalCode: "32801", position: "Ayudante",
      startDate: new Date().toISOString().slice(0, 10), travel: "no", weekends: "no",
      experience: "Synthetic deployment test. Not an applicant.", hasLicense: "no", licenseType: "",
      certifications: "", comments: "Synthetic fixture removed automatically after verification.",
    },
    submissionKey: fixture.key, receiptToken: fixture.token, privacyConsent: true,
    privacyVersion: "recruitment-v1", website: "", resume,
  };
}

try {
  const local = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[key] && local[key]) process.env[key] = local[key];
  }
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  assert.equal(url.protocol, "https:"); assert.equal(url.host, HOST);
  assert.equal(url.username, ""); assert.equal(url.password, "");
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY);
  service = createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  stage = "no_cv_submission";
  const plain = fixtures[0];
  const created = await post("", payload(plain), 200);
  assert.ok(uuid.test(created.id)); plain.id = created.id;
  assert.deepEqual(created, { id: plain.id, status: "submitted" });
  stage = "no_cv_retry";
  assert.deepEqual(await post("", payload(plain), 200), created);
  results.push("no_cv_submission_and_retry");

  stage = "pdf_reservation";
  const document = await PDFDocument.create();
  document.addPage([300, 200]).drawText("SYNTHETIC RECRUITMENT TEST - NOT A REAL APPLICANT", { x: 10, y: 100, size: 8 });
  const bytes = await document.save();
  const cv = fixtures[1];
  const pending = await post("", payload(cv, { name: "synthetic-resume.pdf", type: "application/pdf", size: bytes.length }), 201);
  assert.ok(uuid.test(pending.id)); cv.id = pending.id;
  assert.equal(pending.status, "pending");
  const uploadUrl = new URL(pending.upload?.url);
  assert.equal(uploadUrl.protocol, "https:"); assert.equal(uploadUrl.host, HOST);
  assert.equal(uploadUrl.pathname, `/storage/v1/object/upload/sign/${BUCKET}/${cv.id}/resume.pdf`);
  assert.equal(uploadUrl.username, ""); assert.equal(uploadUrl.password, "");

  stage = "pdf_upload";
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", new File([bytes], "synthetic-resume.pdf", { type: "application/pdf" }));
  const upload = await fetch(uploadUrl, { method: "PUT", redirect: "error", credentials: "omit", headers: { "x-upsert": "false" }, body, signal: AbortSignal.timeout(180000) });
  assert.ok(upload.ok);

  stage = "wrong_receipt_denial";
  await post("/finalize", { id: cv.id, receiptToken: randomBytes(32).toString("hex") }, 404);
  stage = "pdf_finalization";
  const expected = { id: cv.id, status: "submitted" };
  assert.deepEqual(await post("/finalize", { id: cv.id, receiptToken: cv.token }, 200), expected);
  stage = "pdf_finalization_retry";
  assert.deepEqual(await post("/finalize", { id: cv.id, receiptToken: cv.token }, 200), expected);
  results.push("signed_pdf_upload_finalize_and_retry", "wrong_receipt_denied");

  stage = "private_storage_denial";
  const publicFetch = await fetch(`https://${HOST}/storage/v1/object/public/${BUCKET}/${cv.id}/resume.pdf`, { redirect: "error", signal: AbortSignal.timeout(30000) });
  assert.ok([400, 401, 403, 404].includes(publicFetch.status));
  results.push("public_storage_access_denied");
} catch {
  failed = true;
  // Never print caught errors: fetch/assertion errors may contain signed URLs or tokens.
  console.error(JSON.stringify({ result: "FAIL", stage }));
} finally {
  if (service) {
    for (const fixture of fixtures) {
      try {
        // Exact generated key+email recovery also covers a response lost after insertion.
        const found = await service.from("recruitment_applications").select("id")
          .eq("submission_key", fixture.key).eq("email", fixture.email).maybeSingle();
        assert.equal(found.error, null);
        if (!found.data) { assert.equal(fixture.id, null); continue; }
        assert.ok(uuid.test(found.data.id));
        if (fixture.id) assert.equal(found.data.id, fixture.id);
        fixture.id = found.data.id;
        if (fixture.kind === "cv") {
          const removed = await service.storage.from(BUCKET).remove([`${fixture.id}/resume.pdf`]);
          assert.equal(removed.error, null);
        }
        const removed = await service.from("recruitment_applications").delete()
          .eq("id", fixture.id).eq("submission_key", fixture.key).eq("email", fixture.email).select("id");
        assert.equal(removed.error, null); assert.equal(removed.data?.length, 1);
      } catch {
        cleanupFailures.push({ submissionKey: fixture.key, ...(fixture.id ? { id: fixture.id } : {}) });
      }
    }
  }
  if (cleanupFailures.length) {
    failed = true;
    console.error(JSON.stringify({ result: "CLEANUP_FAILED", fixtures: cleanupFailures }));
  }
}
if (!failed) console.log(JSON.stringify({ result: "PASS", checks: results, cleanup: "removed_all_fixtures", reserveRequests: 3, finalizeRequests: 3 }));
process.exitCode = failed ? 1 : 0;
