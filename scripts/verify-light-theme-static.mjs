import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const globals = read("../app/globals.css");
const loginPage = read("../app/login/page.tsx");
const loginStyles = read("../app/login/login.module.css");
const pdfEditor = read("../src/components/jobs/pdf-code-editor.tsx");
const jobDocuments = read("../src/components/jobs/job-documents.tsx");
const statuses = read("../src/lib/jobs/status-presentation.ts");
const users = read("../src/components/users-manager.tsx");

const authenticatedThemeFiles = [
  "../app/equipos/error.tsx",
  "../app/equipos/loading.tsx",
  "../app/jornada/iniciar/page.tsx",
  "../app/produccion/page.tsx",
  "../app/trabajos/[id]/entregar/loading.tsx",
  "../app/trabajos/[id]/page.tsx",
  "../app/trabajos/error.tsx",
  "../app/trabajos/importar/page.tsx",
  "../app/trabajos/loading.tsx",
  "../app/trabajos/nuevo/page.tsx",
  "../app/trabajos/page.tsx",
  "../src/components/catalog-manager.tsx",
  "../src/components/jobs/archive-history.tsx",
  "../src/components/jobs/archived-job-delete-button.tsx",
  "../src/components/jobs/bulk-assign.tsx",
  "../src/components/jobs/bulk-import.tsx",
  "../src/components/jobs/code-input.tsx",
  "../src/components/jobs/crew-manager.tsx",
  "../src/components/jobs/job-attachments.tsx",
  "../src/components/jobs/job-documents.tsx",
  "../src/components/jobs/job-evidence-list.tsx",
  "../src/components/jobs/job-form.tsx",
  "../src/components/jobs/job-list.tsx",
  "../src/components/jobs/office-job-actions.tsx",
  "../src/components/jobs/photo-upload.tsx",
  "../src/components/jobs/technician-actions.tsx",
  "../src/components/jobs/timeline.tsx",
  "../src/components/work-shifts/start-shift-form.tsx",
  "../src/lib/jobs/status-presentation.ts",
  "../src/components/users-manager.tsx",
];

const authenticatedTheme = authenticatedThemeFiles.map(read).join("\n");

assert.match(globals, /--background: #ffffff;/u);
assert.match(globals, /--foreground: #000000;/u);
assert.match(globals, /color-scheme: light;/u);
assert.match(globals, /button \{\s+background: #000000;\s+color: #ffffff;/u);
assert.match(globals, /input,[\s\S]*textarea \{\s+background: #ffffff;\s+color: #000000;/u);
assert.doesNotMatch(globals, /color-scheme: dark|--background: #000000|--foreground: #ffffff/u);

assert.doesNotMatch(
  authenticatedTheme,
  /min-h-screen bg-black|bg-(?:neutral|zinc|slate)-950|bg-amber-950|text-(?:zinc|slate)-(?:100|200|300|400)|text-amber-(?:100|300)|bg-black p-[0-9]|border border-white bg-black/u,
);
assert.doesNotMatch(authenticatedTheme, /border-white/u);

assert.match(statuses, /sin_asignar: "border border-black bg-white text-black"/u);
assert.doesNotMatch(statuses, /bg-(?:zinc|sky|amber|violet|emerald|orange|teal)-950/u);
assert.match(users, /borderTop: "1px solid #000000"/u);

assert.match(pdfEditor, /min-h-screen bg-white[^"]*text-black/u);
assert.match(pdfEditor, /border-t border-black\/30 bg-white\/95/u);
assert.doesNotMatch(pdfEditor, /min-h-screen bg-neutral-950|bg-black\/95/u);
assert.match(pdfEditor, /bg-white\/85 p-1 text-black/u);
assert.match(pdfEditor, /backgroundColor: "#ffffff", borderColor: color, color: "#000000"/u);
assert.match(pdfEditor, /tool === "code" \? "border-black bg-black text-white" : "border-black bg-white text-black"/u);
assert.match(pdfEditor, /tool === "note" \? "border-black bg-black text-white" : "border-black bg-white text-black"/u);
assert.doesNotMatch(jobDocuments, /border-black px-4 font-semibold text-black/u);
assert.match(jobDocuments, /border-black bg-white px-4 font-semibold text-black disabled:opacity-60/u);

assert.match(loginPage, /className=\{styles\.shell\}/u);
assert.match(loginStyles, /\.shell \{[\s\S]*background: #ffffff;[\s\S]*color-scheme: light;/u);
assert.match(loginStyles, /\.primaryButton \{[\s\S]*background: #0094ff;/u);

console.log("PASS authenticated light theme static checks");
