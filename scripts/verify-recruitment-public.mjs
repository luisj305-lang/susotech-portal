import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";

const modules = new Map();
function load(relative, replacements = {}) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replace(/import "server-only";/g, "");
  for (const [original, replacement] of Object.entries(replacements)) code = code.replaceAll(`"${original}"`, JSON.stringify(replacement));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  modules.set(relative, url);
  return import(url);
}
const input = await load("src/lib/recruitment/public-input.ts");
const pdf = await load("src/lib/recruitment/resume-validation.ts", { "./public-input": modules.get("src/lib/recruitment/public-input.ts"), "pdf-lib": import.meta.resolve("pdf-lib") });
const serviceMock = `data:text/javascript,export function createServiceClient(){return globalThis.__recruitmentDb}`;
const http = await load("src/lib/recruitment/public-http.ts", { "./public-input": modules.get("src/lib/recruitment/public-input.ts"), "@/lib/supabase/service": serviceMock });
const routeImports = { "@/lib/supabase/service": serviceMock, "@/lib/recruitment/public-input": modules.get("src/lib/recruitment/public-input.ts"), "@/lib/recruitment/public-http": modules.get("src/lib/recruitment/public-http.ts"), "@/lib/recruitment/resume-validation": modules.get("src/lib/recruitment/resume-validation.ts") };
routeImports["@/lib/recruitment/cleanup"] = "data:text/javascript,export async function cleanupExpiredRecruitment(){return {removed:0}}";
const reserve = await load("app/api/public/applications/route.ts", routeImports);
const finalize = await load("app/api/public/applications/finalize/route.ts", routeImports);

const today = new Date().toISOString().slice(0, 10);
const payload = () => ({ application: { fullName: "Test Applicant", phone: "4075550123", email: "TEST@example.com", city: "Orlando", state: "Florida", postalCode: "32801", position: "Ayudante", startDate: today, travel: "no", weekends: "yes", experience: "Sin experiencia", hasLicense: "no", licenseType: "", certifications: "", comments: "" }, submissionKey: "b24c6980-7786-4db5-8cb5-362c79727f19", receiptToken: "ab".repeat(32), privacyConsent: true, privacyVersion: "recruitment-v1", website: "", resume: null });
const request = (body, origin = "https://susotech.org", endpoint = "") => new Request(`https://portal.susotech.org/api/public/applications${endpoint}`, { method: "POST", headers: { origin, "Content-Type": "application/json", "x-forwarded-for": "192.0.2.1" }, body: JSON.stringify(body) });

function fakeDb() {
  const rows = [];
  const counters = new Map();
  const files = new Map();
  return {
    rows, counters, files,
    async rpc(_name, { p_key }) { const count = (counters.get(p_key) ?? 0) + 1; counters.set(p_key, count); return { data: count <= 5, error: null }; },
    from() {
      let operation = "select", value, filters = [];
      const query = {
        select() { return query; },
        eq(key, expected) { filters.push(row => row[key] === expected); return query; },
        insert(data) { operation = "insert"; value = data; return query; },
        update(data) { operation = "update"; value = data; return query; },
        async single() { return query.maybeSingle(); },
        async maybeSingle() {
          if (operation === "insert") {
            if (rows.some(row => row.submission_key === value.submission_key)) return { data: null, error: { code: "23505" } };
            rows.push({ ...value }); return { data: { ...value }, error: null };
          }
          const row = rows.find(row => filters.every(check => check(row)));
          if (row && operation === "update") Object.assign(row, value);
          return { data: row ? { ...row } : null, error: null };
        },
      }; return query;
    },
    storage: { from() { return {
      async createSignedUploadUrl(path, options) { assert.equal(options.upsert, false); return { data: { signedUrl: `https://storage.example.test/${path}?token=example` }, error: null }; },
      async download(path) { return { data: files.get(path), error: files.has(path) ? null : new Error("Missing") }; },
    }; } },
  };
}

test("normalizes only accepted fields and never accepts office metadata", () => {
  const value = payload(); value.application.status = "hired";
  const parsed = input.parsePublicApplication(value);
  assert.equal(parsed.application.email, "test@example.com");
  assert.equal(parsed.application.has_license, false);
  assert.equal(parsed.application.license_type, null);
  assert.equal(parsed.application.status, undefined);
  assert.equal(parsed.tokenHash.length, 64);
  assert.notEqual(parsed.tokenHash, value.receiptToken);
});
test("rejects missing consent, honeypot, malformed receipt, dates and upload metadata", () => {
  for (const patch of [{ privacyConsent: false }, { website: "spam" }, { receiptToken: "weak" }, { resume: { name: "../cv.pdf", type: "application/pdf", size: 1 } }, { resume: { name: "cv.pdf", type: "application/pdf", size: input.MAX_RESUME_BYTES + 1 } }, { application: { ...payload().application, startDate: "2026-02-30" } }, { application: { ...payload().application, hasLicense: "yes", licenseType: "" } }]) assert.throws(() => input.parsePublicApplication({ ...payload(), ...patch }));
});
test("origin allowlist does not allow deceptive hosts or production localhost", () => {
  assert.equal(input.allowedRecruitmentOrigin("https://susotech.org", true), true);
  for (const origin of [null, "https://susotech.org.evil.test", "https://evil.test", "http://127.0.0.1:5178"]) assert.equal(input.allowedRecruitmentOrigin(origin, true), false);
  assert.equal(input.allowedRecruitmentOrigin("http://127.0.0.1:5178", false), true);
});
test("bounded JSON reader rejects oversized and invalid JSON", async () => {
  await assert.rejects(() => http.readPublicJson(request({ value: "x".repeat(33000) })), error => error.status === 413);
  await assert.rejects(() => http.readPublicJson(new Request("https://example.test", { method: "POST", body: "{" })), error => error.status === 400);
});
test("PDF validator accepts basic pages and rejects bytes and nested active content", async () => {
  const document = await PDFDocument.create(); document.addPage();
  await pdf.validateResumeBytes(await document.save());
  await assert.rejects(() => pdf.validateResumeBytes(new TextEncoder().encode("not a PDF")));
  document.catalog.set(PDFName.of("Names"), document.context.obj({ JavaScript: document.context.obj({ JS: PDFString.of("alert(1)") }) }));
  const activeBytes = await document.save();
  await assert.rejects(() => pdf.validateResumeBytes(activeBytes));
});

test("public route reserve/finalize, retry, rate limit and privacy contracts", async () => {
  const previous = { enabled: process.env.RECRUITMENT_ENABLED, secret: process.env.RECRUITMENT_RATE_LIMIT_SECRET, vercel: process.env.VERCEL };
  process.env.RECRUITMENT_ENABLED = "true"; process.env.RECRUITMENT_RATE_LIMIT_SECRET = "test-only-".repeat(5); process.env.VERCEL = "1";
  try {
    globalThis.__recruitmentDb = fakeDb();
    const denied = await reserve.POST(request(payload(), "https://evil.test"));
    assert.equal(denied.status, 403); assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
    const first = await reserve.POST(request(payload())); assert.equal(first.status, 200);
    const created = await first.json(); assert.equal(created.status, "submitted"); assert.deepEqual(Object.keys(created).sort(), ["id", "status"]);
    assert.equal(first.headers.get("Cache-Control"), "no-store"); assert.equal(first.headers.get("Access-Control-Allow-Origin"), "https://susotech.org");
    const retry = await (await reserve.POST(request(payload()))).json(); assert.equal(retry.id, created.id); assert.equal(globalThis.__recruitmentDb.rows.length, 1);
    assert.equal((await reserve.POST(request({ ...payload(), receiptToken: "cd".repeat(32) }))).status, 409);
    await reserve.POST(request(payload())); await reserve.POST(request(payload()));
    assert.equal((await reserve.POST(request(payload()))).status, 429);

    globalThis.__recruitmentDb = fakeDb();
    const document = await PDFDocument.create(); document.addPage(); const bytes = await document.save();
    const withResume = { ...payload(), resume: { name: "cv.pdf", type: "application/pdf", size: bytes.length } };
    const pending = await (await reserve.POST(request(withResume))).json(); assert.equal(pending.status, "pending");
    assert.equal(globalThis.__recruitmentDb.rows[0].submission_state, "pending");
    assert.equal((await finalize.POST(request({ id: pending.id, receiptToken: "cd".repeat(32) }))).status, 404);
    assert.equal((await finalize.POST(request({ id: pending.id, receiptToken: payload().receiptToken }))).status, 409);
    globalThis.__recruitmentDb.files.set(`${pending.id}/resume.pdf`, new Blob([bytes], { type: "application/pdf" }));
    const complete = await (await finalize.POST(request({ id: pending.id, receiptToken: payload().receiptToken }))).json();
    assert.deepEqual(complete, { id: pending.id, status: "submitted" });
    assert.equal(globalThis.__recruitmentDb.rows[0].submission_state, "submitted");
    assert.equal((await finalize.POST(request({ id: pending.id, receiptToken: payload().receiptToken }))).status, 200);

    globalThis.__recruitmentDb = fakeDb();
    const expired = await (await reserve.POST(request(withResume))).json(); globalThis.__recruitmentDb.rows[0].submission_expires_at = "2000-01-01T00:00:00Z";
    assert.equal((await finalize.POST(request({ id: expired.id, receiptToken: payload().receiptToken }))).status, 410);
    process.env.RECRUITMENT_ENABLED = "false";
    assert.equal((await reserve.POST(request(payload()))).status, 503);
  } finally {
    for (const [key, value] of Object.entries({ RECRUITMENT_ENABLED: previous.enabled, RECRUITMENT_RATE_LIMIT_SECRET: previous.secret, VERCEL: previous.vercel })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    delete globalThis.__recruitmentDb;
  }
});
