import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/202608100200_delivered_job_pdf.sql", "utf8");
const route = await readFile("app/api/trabajos/[id]/pdf-entregado/route.ts", "utf8");
const compositor = await readFile("src/lib/jobs/delivered-pdf.ts", "utf8");
const freshness = await readFile("src/lib/jobs/delivered-status.ts", "utf8");
const types = await readFile("src/lib/jobs/types.ts", "utf8");
const checks = [
  [migration.includes("delivered_pdf_source_photo_ids"), "source photo snapshot"],
  [migration.includes("confirm_delivered_job_pdf"), "atomic confirmation RPC"],
  [/coalesce\(\s*current_setting\('app\.delivered_pdf_confirmation'[\s\S]*?false\s*\);/u.test(migration), "missing confirmation flag fails closed"],
  [migration.includes("o.user_metadata ->> 'source_photo_ids'") && route.includes("source_photo_ids: delivered.sourcePhotoIds.join"), "server object bound to evidence snapshot"],
  [migration.includes("main_status = 'en_progreso'"), "evidence writes restricted to in-progress"],
  [migration.includes("revoke all on function public.confirm_delivered_job_pdf") && migration.includes("to authenticated"), "RPC grants"],
  [route.includes("supabase.auth.getUser()"), "explicit route authentication"],
  [route.includes('.from("job_photos")') && !route.includes("p_source_photo_ids: input"), "server-derived evidence list"],
  [/\.from\("job_photos"\)[\s\S]*?\.eq\("job_id", jobId\)[\s\S]*?\.is\("deleted_at", null\)[\s\S]*?\.order\("created_at"/u.test(route), "soft-deleted evidence excluded from PDF composition"],
  [route.includes('from("project-files").upload') && route.includes("createServiceClient"), "private server upload"],
  [compositor.includes("FPDF_RenderPageBitmap") && compositor.includes("useObjectStreams: false"), "fresh PDFium raster composition"],
  [compositor.includes(".rotate()") && compositor.includes("withoutEnlargement: true"), "EXIF and aspect-ratio image normalization"],
  [types.includes('"pending" | "current" | "stale"') && freshness.includes("getDeliveredPdfStatus"), "freshness states"],
];
for (const [passed, label] of checks) if (!passed) throw new Error(`FAIL: ${label}`);
console.log(`PASS delivered PDF static checks=${checks.length}`);
