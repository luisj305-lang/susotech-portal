import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { snapArrowTip } from "../src/lib/jobs/pdf-code-editor-core.ts";

assert.deepEqual(snapArrowTip(0.304, 0.699, 0.3, 0.5), { x: 0.3, y: 0.699 }, "near-vertical arrows snap to the box center");
assert.deepEqual(snapArrowTip(0.8, 0.407, 0.2, 0.2, [{ x: 0.81, y: 0.4 }]), { x: 0.81, y: 0.4 }, "repeated arrow tips share nearby axes");
assert.deepEqual(snapArrowTip(-2, 4, 0.5, 0.5), { x: 0, y: 1 }, "arrow clicks remain inside the page");

const [editor, deliveryRoute, compositor, deliverPage, officeActions] = await Promise.all([
  readFile("src/components/jobs/pdf-code-editor.tsx", "utf8"),
  readFile("app/api/trabajos/[id]/pdf-entregado/route.ts", "utf8"),
  readFile("src/lib/jobs/delivered-pdf.ts", "utf8"),
  readFile("app/trabajos/[id]/entregar/page.tsx", "utf8"),
  readFile("src/components/jobs/office-job-actions.tsx", "utf8"),
]);
for (const token of ["Excluir página", "Restaurar página", "excludedPages", "snapArrowTip", "h-3 w-3"])
  assert.ok(editor.includes(token), `editor missing ${token}`);
assert.ok(deliveryRoute.includes('profile.role === "admin" || profile.role === "supervisor"'), "admin and supervisor must be authorized server-side");
assert.ok(deliveryRoute.includes("isTechnician && excludedPages.length"), "technicians must not be able to exclude pages by forging the request");
assert.ok(compositor.includes("if (excludedPages.includes(combinedPage)) continue"), "excluded source pages must not be rendered");
assert.ok(deliverPage.includes("canMutateJobWork(profile)"), "office roles must be able to open the editor");
assert.ok(officeActions.includes("Editar PDF final"), "office users need a visible path into the editor");
console.log("[pdf-editor-improvements] PASS");
