import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const editor = await readFile("src/components/jobs/pdf-code-editor.tsx", "utf8");

assert.match(editor, /data-pdf-editor="workspace"/u, "the editor needs an explicit responsive workspace");
assert.match(editor, /data-pdf-editor="desktop-tool-rail"/u, "desktop tools belong in a vertical rail");
assert.match(editor, /data-pdf-editor="mobile-tool-dock"/u, "mobile tools belong in a thumb-friendly bottom dock");
assert.match(editor, /data-pdf-editor="context-panel"/u, "tool options belong in a contextual panel");
assert.match(editor, /max-h-\[35dvh\]/u, "the mobile contextual sheet must stay below 35% of the viewport");
assert.match(editor, /lg:w-\[19rem\]/u, "the desktop contextual panel must remain near 300px wide");
assert.match(editor, /data-pdf-editor="floating-controls"/u, "compact canvas controls must float over the workspace");
assert.match(editor, /aria-label="Deshacer \u00faltimo cambio"/u, "undo must remain accessible");
assert.match(editor, /aria-label="Rehacer \u00faltimo cambio"/u, "redo must remain accessible");
assert.match(editor, /historyGestureMutatedRef/u, "gestures need a mutation guard before committing history");
const gestureStart = editor.match(/const beginHistoryGesture = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/u)?.[1] ?? "";
assert.ok(gestureStart, "the gesture-start transaction must remain explicit");
assert.doesNotMatch(gestureStart, /recordHistory\(\)/u, "pointer-down alone must not clear redo");
assert.match(editor, /historyGestureActiveRef\.current[\s\S]{0,220}!historyGestureMutatedRef\.current[\s\S]{0,220}recordHistory\(\)/u, "the first real gesture mutation must create one checkpoint");
assert.match(editor, /h-\[35dvh\][^"\n]*max-h-\[35dvh\]/u, "the mobile sheet needs a concrete bounded height");
assert.match(editor, /overflow-y-auto[^"\n]*touch-pan-y/u, "all contextual controls must remain touch-scrollable");
assert.match(editor, /renderToolButton\("code", "Código"\)/u);
assert.match(editor, /renderToolButton\("note", "Nota"\)/u);
assert.match(editor, /renderToolButton\("line", "Línea"\)/u);
assert.ok(
  editor.indexOf("Confirmar PDF") < editor.indexOf('data-pdf-editor="workspace"'),
  "Confirmar PDF must remain visible in the compact header before the canvas",
);
assert.doesNotMatch(editor, /max-h-\[40vh\]/u, "the old oversized bottom sheet must be removed");

console.log("[pdf-editor-responsive-static] PASS");
