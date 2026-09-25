import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";

const sourceFiles = [
  "src/lib/jobs/delivered-pdf.ts",
  "src/lib/jobs/delivered-pdf-replacement.ts",
  "src/components/jobs/delivered-pdf-page-remover.tsx",
  "src/components/jobs/job-documents.tsx",
  "src/components/jobs/pdf-code-editor.tsx",
  "app/trabajos/[id]/page.tsx",
  "app/api/trabajos/[id]/pdf-entregado/route.ts",
  "app/api/trabajos/[id]/pdf-entregado/miniatura/route.ts",
  "app/api/trabajos/[id]/pdf-entregado/quitar-paginas/route.ts",
];
if (process.argv.includes("--typecheck")) {
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent({ ...config.config, include: [...sourceFiles, "next-env.d.ts"] }, ts.sys, process.cwd());
  const options = { ...parsed.options, noEmit: true, incremental: false };
  const host = ts.createCompilerHost(options);
  const read = host.readFile;
  host.readFile = (file) => {
    if (/(?:^|[/\\])(?:prueba|recruitment|postulantes)(?:[/\\]|$)|app[/\\]api[/\\]public[/\\]/u.test(file)) {
      throw new Error("Protected out-of-scope source requested by type checker");
    }
    return read(file);
  };
  const program = ts.createProgram(parsed.fileNames, options, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  }));
  console.log(JSON.stringify({ result: diagnostics.length ? "FAIL" : "PASS", scope: "9 feature roots and transitive dependencies", diagnostics: diagnostics.length }));
  process.exit(diagnostics.length ? 1 : 0);
}

// Load the actual handlers/helpers in memory; only auth/storage/framework
// boundaries are substituted. No credentials, server, fixtures, or files written.
globalThis.fetch = async () => { throw new Error("Unexpected network access"); };
const stubs = {
  "server-only": "export {};",
  "next/server": "export const NextResponse = { json: (body, init) => Response.json(body, init) };",
  "@/lib/supabase/server": "export const createClient = async () => globalThis.pdfRemovalTest.client;",
  "@/lib/supabase/service": "export const createServiceClient = () => globalThis.pdfRemovalTest.service;",
  "@/lib/jobs/document-manifest": "export const ensureVerifiedDocumentManifest = () => { throw Error('Unexpected generation'); }; export const downloadVerifiedSourceDocuments = ensureVerifiedDocumentManifest;",
  "@/lib/jobs/pdf-code-editor-core": "export const DEFAULT_CODE_COLOR = '#000000'; export const validatePlacements = () => null;",
  "@/lib/jobs/pdf-text-note-core": "export const validatePdfTextNotes = () => null;",
  "@/lib/jobs/pdf-line-core": "export const validatePdfLines = () => null;",
  "@/lib/work-shifts/types": "export const ACTIVE_SHIFT_REQUIRED_MESSAGE = 'Active shift required';",
  "@/lib/auth/capabilities": "export const isOperationalFieldWorker = (p) => p.worker_specialty === 'liniero'; export const READ_ONLY_HELPER_MESSAGE = 'Read only';",
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in stubs) return { url: `test:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(path.resolve("src", `${specifier.slice(2)}.ts`)).href, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("test:")) return { format: "module", source: stubs[url.slice(5)], shortCircuit: true };
    if (url.endsWith(".ts") && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText };
    }
    return nextLoad(url, context);
  },
});
const { composeDeliveredPdf, removeDeliveredPdfPages, renderDeliveredPdfPreview } = await import("../src/lib/jobs/delivered-pdf.ts");
const { getDeliveredPdfStatus } = await import("../src/lib/jobs/delivered-status.ts");
const { requestDeliveredPdfGeneration } = await import("../src/lib/jobs/delivered-pdf-replacement.ts");
const { POST } = await import("../app/api/trabajos/[id]/pdf-entregado/quitar-paginas/route.ts");
const { GET } = await import("../app/api/trabajos/[id]/pdf-entregado/miniatura/route.ts");
const { POST: generate } = await import("../app/api/trabajos/[id]/pdf-entregado/route.ts");
const jobId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const photoId = "44444444-4444-4444-8444-444444444444";
const originalPath = `${jobId}/delivered/55555555-5555-4555-8555-555555555555.pdf`;
const context = { params: Promise.resolve({ id: jobId }) };
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const source = await PDFDocument.create();
for (const color of [rgb(1, 0, 0), rgb(0, 1, 0)]) {
  source.addPage([144, 180]).drawRectangle({ x: 12, y: 12, width: 120, height: 156, color });
}
const sourceBytes = await source.save();
const photoBytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#0000ff" } }).png().toBuffer();
const sourceBefore = Buffer.from(sourceBytes);
const photoBefore = Buffer.from(photoBytes);
const delivered = await composeDeliveredPdf([{ id: sourceId, bytes: sourceBytes }], [{ id: photoId, bytes: photoBytes }]);
check(delivered.pageCount === 3, "Real compositor produces two source pages and one evidence page");
const previews = await Promise.all([1, 2, 3].map((page) => renderDeliveredPdfPreview(delivered.bytes, page)));
check(previews.every((preview) => Math.max(preview.width, preview.height) <= 480), "Thumbnails use bounded raster dimensions");
const trimmed = await removeDeliveredPdfPages(delivered.bytes, [1, 1]);
check((await PDFDocument.load(trimmed)).getPageCount() === 2, "Duplicate selection removes a page once");
assert.deepEqual((await renderDeliveredPdfPreview(trimmed, 1)).png, previews[1].png);
assert.deepEqual((await renderDeliveredPdfPreview(trimmed, 2)).png, previews[2].png);
const repeated = await removeDeliveredPdfPages(trimmed, [2]);
assert.deepEqual((await renderDeliveredPdfPreview(repeated, 1)).png, previews[1].png);
assert.deepEqual(Buffer.from(sourceBytes), sourceBefore);
assert.deepEqual(photoBytes, photoBefore);
checks += 5;
for (const pages of [[], [0], [-1], [1.5], [NaN], [Infinity], [4], [1, "2"], [1, 99], null, [1, 2, 3]]) {
  await assert.rejects(() => removeDeliveredPdfPages(delivered.bytes, pages)); checks++;
}
for (const page of [0, -1, NaN, Infinity, 1.5, 4]) {
  await assert.rejects(() => renderDeliveredPdfPreview(delivered.bytes, page)); checks++;
}
for (const bytes of [new Uint8Array(), Buffer.from("not a PDF"), new Uint8Array(100 * 1024 * 1024 + 1)]) {
  await assert.rejects(() => removeDeliveredPdfPages(bytes, [1]));
  await assert.rejects(() => renderDeliveredPdfPreview(bytes, 1)); checks += 2;
}
const large = await PDFDocument.create();
for (let index = 0; index < 130; index++) large.addPage([10, 10]);
const largeBytes = await large.save();
check((await PDFDocument.load(await removeDeliveredPdfPages(largeBytes, Array.from({ length: 129 }, (_, i) => i + 1)))).getPageCount() === 1, "All but one of 130 pages can be removed");

function fixture(options = {}) {
  const state = {
    user: { id: actorId }, profile: { role: "admin", is_active: true },
    job: { id: jobId, delivered_pdf_path: originalPath, delivered_pdf_source_photo_ids: [photoId], delivered_pdf_source_document_ids: [sourceId], main_status: "en_revision", archived_at: null, project_pdf_url: `${jobId}/original.pdf` },
    objects: new Map([[originalPath, delivered.bytes]]), calls: [], rpcError: null, commitOnError: false, currentReadError: false,
    ...options,
  };
  state.client = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from(table) {
      state.calls.push(`query:${table}`);
      assert.ok(["profiles", "jobs"].includes(table), `Unexpected query: ${table}`);
      const query = {
        select() { return query; }, eq() { return query; },
        single: async () => ({ data: state.profile, error: null }),
        maybeSingle: async () => ({ data: { ...state.job }, error: state.currentReadError && state.calls.includes("rpc") ? { message: "Read unavailable" } : null }),
      };
      return query;
    },
    async rpc(name, input) {
      state.calls.push("rpc");
      assert.equal(name, "remove_delivered_pdf_pages");
      assert.deepEqual(input.p_source_photo_ids, [photoId]);
      assert.equal(input.p_expected_path, originalPath);
      if (!state.rpcError || state.commitOnError) state.job.delivered_pdf_path = input.p_storage_path;
      return { error: state.rpcError };
    },
  };
  state.service = { storage: { from(bucket) {
    assert.equal(bucket, "project-files");
    return {
      async download(key) { state.calls.push("download"); return { data: new Blob([state.objects.get(key)]), error: null }; },
      async upload(key, bytes, options) {
        state.calls.push("upload");
        assert.equal(options.upsert, false);
        assert.equal(options.metadata.expected_path, originalPath);
        assert.equal(options.metadata.operation, "page-removal");
        state.objects.set(key, bytes);
        return { error: null };
      },
      async remove() { assert.fail("Removal must not delete committed, source, or uncertain objects"); },
    };
  } } };
  globalThis.pdfRemovalTest = state;
  return state;
}
const request = (body) => new Request("http://local.test/removal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const validInput = { pages: [3], expectedPath: originalPath };
for (const body of [null, [], {}, { ...validInput, pages: [1, "2"] }, { ...validInput, pages: [0] }, { ...validInput, pages: [131] }, { pages: [1] }]) {
  const state = fixture();
  check((await POST(request(body), context)).status === 400, "Invalid removal input is rejected");
  check(!state.calls.includes("download"), "Invalid input does not access storage");
}
for (const [profile, user, expected] of [
  [{ role: "tecnico", is_active: true }, { id: actorId }, 403],
  [{ role: "admin", is_active: false }, { id: actorId }, 403],
  [{ role: "admin", is_active: true }, null, 401],
]) {
  const state = fixture({ profile, user });
  check((await POST(request(validInput), context)).status === expected, "Removal enforces office authorization");
  check((await GET(new Request(`http://local.test/preview?expectedPath=${encodeURIComponent(originalPath)}`), context)).status === expected, "Preview enforces office authorization");
  check(!state.calls.includes("download"), "Unauthorized request does not access storage");
}
for (const patch of [{ main_status: "aprobado" }, { main_status: "facturado" }, { main_status: "pagado" }, { archived_at: "2026-09-14" }, { delivered_pdf_path: `${jobId}/delivered/changed.pdf` }]) {
  const state = fixture(); Object.assign(state.job, patch);
  check((await POST(request(validInput), context)).status === 409, "Status/archive/revision is enforced before download");
  check((await GET(new Request(`http://local.test/preview?expectedPath=${encodeURIComponent(originalPath)}`), context)).status === 409, "Thumbnail cannot switch revisions");
  check(!state.calls.includes("download"), "Conflicting request does not access storage");
}
for (const role of ["admin", "supervisor"]) {
  const state = fixture({ profile: { role, is_active: true } });
  if (role === "admin") state.job.main_status = "asignado";
  const response = await POST(request(validInput), context);
  check(response.status === 200, `${role} can remove an evidence page`);
  assert.deepEqual(state.job.delivered_pdf_source_photo_ids, [photoId]);
  check(getDeliveredPdfStatus(state.job, [photoId], [sourceId]) === "current", "Intentional trim is not stale");
  check(getDeliveredPdfStatus(state.job, [photoId, actorId], [sourceId]) === "stale", "Actual source changes remain stale");
  check(state.objects.has(originalPath), "Previous delivered PDF is retained");
  check((await PDFDocument.load(state.objects.get(state.job.delivered_pdf_path))).getPageCount() === 2, "Handler uploads actual trimmed bytes");
  check((await POST(request(validInput), context)).status === 409, "Repeating stale request cannot delete another page");
}
for (const options of [
  { rpcError: { message: "Transport lost" }, commitOnError: true },
  { rpcError: { message: "Transport lost" }, currentReadError: true },
  { rpcError: { message: "Delivered PDF changed" } },
]) {
  const state = fixture(options);
  check((await POST(request(validInput), context)).status === (options.commitOnError ? 200 : 409), "RPC ambiguity and conflict are handled safely");
  check(state.objects.size === 2, "Uncertain and prior objects are retained");
}
fixture();
check((await POST(request({ ...validInput, pages: [1, 2, 3] }), context)).status === 409, "Handler prevents removing every page");
fixture();
const thumbnail = await GET(new Request(`http://local.test/preview?expectedPath=${encodeURIComponent(originalPath)}&page=3`), context);
check(thumbnail.status === 200 && thumbnail.headers.get("x-page-count") === "3", "Actual preview handler renders evidence");
check(thumbnail.headers.get("cache-control") === "private, no-store", "Private preview is not cached");
fixture();
const challenge = await generate(request({ submit: false }), context);
const challengeBody = await challenge.json();
check(challenge.status === 409 && challengeBody.requiresReplacementConfirmation, "Existing PDF requires explicit generation confirmation");
check((await generate(request({ submit: false, confirmReplacement: true, expectedPath: "stale" }), context)).status === 409, "Replacement confirmation binds to current PDF");
for (const accepted of [false, true]) {
  const calls = [];
  globalThis.window = { confirm: () => accepted };
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return calls.length === 1 ? Response.json(challengeBody, { status: 409 }) : Response.json({ message: "Generated" });
  };
  const result = await requestDeliveredPdfGeneration(jobId, { submit: false });
  check(result.ok === accepted && calls.length === (accepted ? 2 : 1), "Replacement cancellation keeps current PDF; confirmation retries only once");
  if (accepted) assert.equal(calls[1].expectedPath, originalPath);
}
hooks.deregister();
console.log(JSON.stringify({ result: "PASS", checks, realPdfiumAndPdfLib: true, routeBoundaries: "in-memory auth/storage stubs", network: "none" }));
