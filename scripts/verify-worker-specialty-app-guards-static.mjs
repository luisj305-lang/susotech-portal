import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = Object.fromEntries(await Promise.all([
  "app/api/trabajos/[id]/pdf-entregado/route.ts",
  "app/api/trabajos/[id]/pdf-original-preview/route.ts",
  "app/trabajos/[id]/entregar/page.tsx",
  "app/trabajos/[id]/page.tsx",
  "src/lib/jobs/actions.ts",
  "src/lib/storage/actions.ts",
].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), "utf8")])));

for (const path of [
  "app/api/trabajos/[id]/pdf-entregado/route.ts",
  "app/api/trabajos/[id]/pdf-original-preview/route.ts",
]) {
  const source = files[path];
  assert.match(source, /worker_specialty/u, `${path} must load specialty`);
  assert.match(source, /isOperationalFieldWorker\(profile\)/u, `${path} must reject read-only helpers`);
  assert.ok(
    source.indexOf("isOperationalFieldWorker(profile)") < source.indexOf("createServiceClient()"),
    `${path} must reject helpers before privileged service work`,
  );
}

assert.match(files["app/trabajos/[id]/entregar/page.tsx"], /if \(!isOperationalFieldWorker\(profile\)\) notFound\(\)/u);
assert.match(files["app/trabajos/[id]/page.tsx"], /canMutate && <TechnicianActions/u);
assert.match(files["app/trabajos/[id]/page.tsx"], /canMutate && \["en_progreso", "enviado_revision"\]\.includes\(job\.main_status\) && <PhotoUpload/u);

const actions = files["src/lib/jobs/actions.ts"];
for (const name of ["transitionJob", "setIncident", "addProductionCode", "saveJobPdfDraft", "addPhotoComment"]) {
  const start = actions.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.match(actions.slice(start, start + 550), /technicianMutationFailure\(profile\)/u, `${name} must enforce specialty`);
}

assert.match(files["src/lib/storage/actions.ts"], /createPhotoUploadUrl[\s\S]*?profile\.role !== "admin" && !isOperationalFieldWorker\(profile\)/u);
assert.match(files["src/lib/storage/actions.ts"], /discardUnconfirmedPhotoUpload[\s\S]*?profile\.role !== "admin" && !isOperationalFieldWorker\(profile\)/u);

console.log("PASS worker specialty app mutation guards");
