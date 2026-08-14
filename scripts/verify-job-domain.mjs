import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INCIDENT_TYPES,
  JOB_STATUS_ORDER,
  canTransition,
  isOfficeRole,
  nextStatus,
} from "../src/lib/jobs/state.ts";

const transitionCases = [
  ["technician starts assigned job", true, ["asignado", null, "en_progreso", null, "tecnico"]],
  ["technician submits active job", true, ["en_progreso", null, "enviado_revision", null, "tecnico"]],
  ["technician cannot approve", false, ["enviado_revision", null, "aprobado", null, "tecnico"]],
  ["technician cannot skip state", false, ["asignado", null, "aprobado", null, "tecnico"]],
  ["admin advances assigned job", true, ["asignado", null, "en_progreso", null, "admin"]],
  ["supervisor approves review", true, ["enviado_revision", null, "aprobado", null, "supervisor"]],
  ["admin marks approved job payable", true, ["aprobado", null, "listo_pagar", null, "admin"]],
  ["supervisor marks payable job paid", true, ["listo_pagar", null, "pagado", null, "supervisor"]],
  ["office cannot skip state", false, ["asignado", null, "aprobado", null, "admin"]],
  ["return requires reason", false, ["enviado_revision", null, "en_progreso", null, "supervisor"]],
  ["blank return reason rejected", false, ["enviado_revision", null, "en_progreso", null, "admin", "  "]],
  ["return with reason allowed", true, ["enviado_revision", null, "en_progreso", null, "supervisor", "Corrección"]],
  ["technician adds incident only", true, ["en_progreso", null, "en_progreso", "no_access", "tecnico"]],
  ["technician resolves incident only", true, ["en_progreso", "no_access", "en_progreso", null, "tecnico"]],
  ["office resolves incident only", true, ["enviado_revision", "returned", "enviado_revision", null, "admin"]],
  ["technician cannot combine changes", false, ["asignado", null, "en_progreso", "need_cr", "tecnico"]],
  ["office cannot combine changes", false, ["enviado_revision", null, "aprobado", "returned", "supervisor"]],
  ["no-op rejected", false, ["en_progreso", null, "en_progreso", null, "admin"]],
];

for (const [label, expected, values] of transitionCases) {
  const [currentStatus, currentIncident, newStatus, newIncident, role, reason] = values;
  const result = canTransition({ currentStatus, currentIncident, newStatus, newIncident, role, reason });
  assert.equal(result.allowed, expected, label);
}

assert.deepEqual(JOB_STATUS_ORDER, [
  "sin_asignar", "asignado", "en_progreso", "enviado_revision", "aprobado", "listo_pagar", "pagado",
]);
assert.deepEqual(INCIDENT_TYPES, [
  "need_splicing", "no_access", "need_cr", "permit_pending", "returned", "incomplete",
]);
assert.equal(isOfficeRole("admin"), true);
assert.equal(isOfficeRole("supervisor"), true);
assert.equal(isOfficeRole("tecnico"), false);
assert.equal(nextStatus("asignado"), "en_progreso");
assert.equal(nextStatus("pagado"), null);

const typesSource = readFileSync(new URL("../src/lib/jobs/types.ts", import.meta.url), "utf8");
for (const contract of [
  "export type JobStatus", "export type IncidentType", "export type AssigneeType",
  "export type JobCategory", "export interface Job", "export interface Crew",
  "export interface JobAssignment", "export interface JobStatusHistoryEntry",
  "export interface JobProductionCode", "export interface JobPhoto",
]) {
  assert.ok(typesSource.includes(contract), `missing type contract: ${contract}`);
}

const sessionSource = readFileSync(new URL("../src/lib/auth/session.ts", import.meta.url), "utf8");
assert.match(sessionSource, /export async function requireSupervisor\(\)/u);
assert.match(sessionSource, /const profile = await requireProfile\(\)/u);
assert.match(sessionSource, /profile\.role === "admin" \? profile : requireRole\("supervisor"\)/u);
assert.match(sessionSource, /redirect\("\/acceso-denegado"\)/u);

const actionsSource = readFileSync(new URL("../src/lib/jobs/actions.ts", import.meta.url), "utf8");
for (const action of ["createJob", "updateJob", "assignJob", "unassignJob", "transitionJob", "setIncident", "addProductionCode", "addPhotoComment", "assignJobsInBulk"]) {
  assert.match(actionsSource, new RegExp(`export async function ${action}\\b`, "u"));
}
const storageSource = readFileSync(new URL("../src/lib/storage/actions.ts", import.meta.url), "utf8");
for (const action of ["createPhotoUploadUrl", "createProjectUploadUrl", "createSignedDownloadUrl", "prepareBulkProjectUpload", "confirmBulkProjectUpload"]) {
  assert.match(storageSource, new RegExp(`export async function ${action}\\b`, "u"));
}
assert.doesNotMatch(storageSource, /uploadProjectPdfs|FormData|File|Blob|ArrayBuffer|Uint8Array/u);
assert.ok(actionsSource.startsWith('"use server";') && storageSource.startsWith('"use server";'));
assert.ok(!actionsSource.includes("service_role") && !storageSource.includes("service_role"));
const rpcSource = readFileSync(new URL("../supabase/migrations/20260810002000_jobs_assignment_rpc.sql", import.meta.url), "utf8");
assert.match(rpcSource, /assign_jobs_atomic/u);
assert.match(rpcSource, /update public\.job_assignments[\s\S]*insert into public\.job_assignments/u);

const officeContracts = [
  ["../app/trabajos/page.tsx", [/await requireProfile\(\)/u, /await searchParams/u, /listOfficeJobs/u]],
  ["../app/trabajos/nuevo/page.tsx", [/await requireSupervisor\(\)/u, /<JobForm/u]],
  ["../app/trabajos/[id]/page.tsx", [/await params/u, /<OfficeJobActions/u, /<Timeline/u]],
  ["../src/components/jobs/job-form.tsx", [/^"use client";/u, /createJob/u, /updateJob/u]],
  ["../src/components/jobs/timeline.tsx", [/JobStatusHistoryEntry/u, /entries\.map/u]],
];
for (const [path, patterns] of officeContracts) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  for (const pattern of patterns) assert.match(source, pattern, `${path} misses ${pattern}`);
  assert.ok(!source.includes("service_role"), `${path} exposes privileged credentials`);
}

const bulkUiContracts = [
  ["../app/trabajos/importar/page.tsx", [/await requireSupervisor\(\)/u, /listAssigneeOptions/u, /<BulkImport/u]],
  ["../src/components/jobs/bulk-import.tsx", [/^"use client";/u, /onDrop=/u, /multiple/u, /extractPdfPreview/u, /uploadToSignedUrl/u, /prepareBulkProjectUpload/u, /confirmBulkProjectUpload/u, /assignJobsInBulk/u, /retryOnly/u, /selectUploadTargets/u, /Asignación masiva/u]],
  ["../src/components/jobs/bulk-import-model.ts", [/pending.*processing.*imported.*duplicate.*error/u, /pageSize = 50/u, /filterImportRows/u]],
  ["../supabase/migrations/20260810004000_jobs_bulk_import.sql", [/create table public\.job_imports/u, /confirm_job_import/u, /source_file_hash/u, /imported_by/u]],
];
let bulkContractCount = 0;
for (const [path, patterns] of bulkUiContracts) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  for (const pattern of patterns) { assert.match(source, pattern, `${path} misses ${pattern}`); bulkContractCount += 1; }
  assert.ok(!source.includes("service_role"), `${path} exposes privileged credentials`);
}

const technicianUiContracts = [
  ["../app/trabajos/page.tsx", [/profile\.role === "tecnico"/u, /listTechnicianJobs/u, /<JobList/u]],
  ["../app/trabajos/[id]/page.tsx", [/profile\.role === "tecnico"/u, /getTechnicianJob/u, /<TechnicianActions/u, /<JobAttachments/u, /<PhotoUpload/u, /Producción histórica/u]],
  ["../src/components/jobs/job-list.tsx", [/min-h-40/u, /jobs\.map/u, /No tienes trabajos asignados/u]],
  ["../src/components/jobs/technician-actions.tsx", [/^"use client";/u, /transitionJob/u, /setIncident/u, /\/trabajos\/\$\{jobId\}\/entregar/u, /Entregar trabajo/u, /min-h-14/u]],
  ["../src/components/jobs/job-documents.tsx", [/^"use client";/u, /createSignedDownloadUrl/u, /Ver PDF original/u, /Ver PDF entregado/u]],
  ["../src/components/jobs/photo-upload.tsx", [/^"use client";/u, /createPhotoUploadUrl/u, /uploadToSignedUrl/u, /addPhotoComment/u, /capture="environment"/u]],
  ["../src/components/jobs/pdf-code-editor.tsx", [/^"use client";/u, /quantity/u, /arrowTipX/u, /Confirmar y enviar/u]],
];
let technicianContractCount = 0;
for (const [path, patterns] of technicianUiContracts) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  for (const pattern of patterns) { assert.match(source, pattern, `${path} misses ${pattern}`); technicianContractCount += 1; }
  assert.ok(!source.includes("service_role"), `${path} exposes privileged credentials`);
}

console.log(`[jobs-domain] PASS transitions=${transitionCases.length} state=8 types=10 guards=4 actions=9 storage=5 rpc=2 office=14 bulk_ui=${bulkContractCount} technician_ui=${technicianContractCount}`);
