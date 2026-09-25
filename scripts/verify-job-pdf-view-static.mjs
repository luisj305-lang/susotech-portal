import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [route, core, documents, component, storageCore] = await Promise.all([
  readFile("app/api/trabajos/[id]/pdf-view/[kind]/route.ts", "utf8"),
  readFile("src/lib/jobs/pdf-view-core.ts", "utf8"),
  readFile("src/lib/jobs/document-manifest.ts", "utf8"),
  readFile("src/components/jobs/job-documents.tsx", "utf8"),
  readFile("src/lib/storage/core.ts", "utf8"),
]);

const checks = [
  [/params: Promise<\{ id: string; kind: string \}>/u.test(route), "route accepts only dynamic job and kind parameters"],
  [/parseJobPdfViewKind\(rawKind\)/u.test(route) && /JOB_PDF_VIEW_KINDS = \["original", "delivered"\]/u.test(core), "kind is constrained to original or delivered"],
  [!route.includes("searchParams") && !route.includes("request.json") && !route.includes("storagePath:") , "route does not accept a client storage path"],
  [/supabase\.auth\.getUser\(\)/u.test(route) && /from\("profiles"\)[\s\S]*?is_active/u.test(route), "route requires an active authenticated reader"],
  [/from\("jobs"\)[\s\S]*?select\("project_pdf_url, delivered_pdf_path"\)[\s\S]*?eq\("id", jobId\)[\s\S]*?maybeSingle/u.test(route), "route reads paths only from the current RLS-authorized job"],
  [/resolveJobPdfViewStoragePath\(jobId, kind, job\)/u.test(route) && /storagePath\.startsWith\(`\$\{jobId\}\/`\)/u.test(core), "server-derived paths are bound to the current job"],
  [/ensureVerifiedDocumentManifest\(service, jobId, storagePath\)[\s\S]*?downloadVerifiedSourceDocuments\(service, sourceDocuments\)[\s\S]*?flattenSourceDocuments\(sources\)/u.test(route), "original view downloads and flattens verified source documents"],
  [/"content-type": "application\/pdf"/u.test(route) && /"content-disposition": `inline;/u.test(route) && /"cache-control": "private, no-store"/u.test(route) && /"content-length": String\(flattened\.bytes\.length\)/u.test(route), "original response has inline PDF, no-store, and length headers"],
  [/if \(kind === "delivered"\)[\s\S]*?createSignedUrl\(storagePath, PDF_VIEWER_SIGNED_URL_TTL_SECONDS\)[\s\S]*?status: 302[\s\S]*?location: signed\.data\.signedUrl/u.test(route), "delivered view redirects to a fresh private viewer URL"],
  [/PDF_VIEWER_SIGNED_URL_TTL_SECONDS = 15 \* 60/u.test(core) && /Math\.min\(60, Math\.floor\(input\.expiresIn \?\? 60\)\)/u.test(storageCore), "viewer URL duration is bounded separately from generic 60-second downloads"],
  [/downloadVerifiedSourceDocuments[\s\S]*?createHash\("sha256"\)[\s\S]*?document\.file_hash/u.test(documents), "source bytes are checked against their verified hashes"],
  [/const openCompatibleView = \(kind: "original" \| "delivered"\)/u.test(component) && /preview\.location\.replace\(`\/api\/trabajos\/\$\{jobId\}\/pdf-view\/\$\{kind\}`\)/u.test(component), "UI opens controlled internal compatible views in a popup-safe tab"],
  [/openCompatibleView\("original"\)[\s\S]*?Abrir vista compatible para móvil[\s\S]*?open\(originalPath\)[\s\S]*?Abrir original sin modificar/u.test(component), "original actions distinguish compatible viewing from the untouched source"],
  [/openCompatibleView\("delivered"\)[\s\S]*?>Ver PDF entregado/u.test(component), "delivered PDF action uses the internal viewer route"],
];

for (const [passed, label] of checks) assert.ok(passed, `FAIL: ${label}`);
console.log(`PASS job PDF view static checks=${checks.length}`);
