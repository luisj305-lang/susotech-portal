import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const editor = await readFile("src/components/jobs/pdf-code-editor.tsx", "utf8");
const source = ts.createSourceFile("editor.tsx", editor, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(source.parseDiagnostics.length, 0, "the editor JSX must parse");
const elements = [];
let collapseHandler;
function visit(node) {
  if (ts.isJsxElement(node)) elements.push(node);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "collapsePanel") collapseHandler = node.initializer;
  ts.forEachChild(node, visit);
}
visit(source);
const attribute = (element, name) => element.openingElement.attributes.properties.find((item) => item.name?.getText(source) === name)?.initializer;
const value = (element, name) => attribute(element, name)?.getText(source) ?? "";
const region = (name) => {
  const element = elements.find((item) => value(item, "data-pdf-editor") === JSON.stringify(name));
  assert.ok(element, `missing ${name}`);
  return element;
};
const panel = region("context-panel");
const toolbar = region("canvas-toolbar");
const canvas = region("canvas-scroll");
const dock = region("mobile-tool-dock");
for (const element of [panel, toolbar, dock]) {
  assert.doesNotMatch(value(element, "className"), /\b(?:fixed|absolute)\b/u, "controls must reserve layout space, not overlay the PDF");
}
assert.equal(canvas.parent, toolbar.parent, "the toolbar must sit outside the scrollable document");
assert.match(value(canvas, "className"), /min-h-0 flex-1 overflow-auto/u, "only the document area should scroll");
assert.match(value(region("workspace"), "className"), /grid-rows-\[minmax\(0,1fr\)_auto\]/u, "mobile reserves a separate panel row");
assert.match(value(region("workspace"), "className"), /lg:grid-rows-1/u, "desktop keeps a single workspace row");
assert.match(value(panel, "className"), /h-\[30dvh\].*max-h-\[15rem\]/u, "mobile panel is capped at 30dvh and 240px");
assert.match(value(panel, "className"), /lg:h-full lg:max-h-none lg:w-\[19rem\]/u, "desktop retains its full-height 19rem panel");
assert.match(editor, /flex h-dvh min-h-0 flex-col overflow-hidden/u, "the workspace must follow dynamic viewport height");
for (const edge of ["top", "bottom", "left", "right"]) assert.ok(editor.includes(`env(safe-area-inset-${edge})`), `missing ${edge} safe area`);

const toggle = elements.find((item) => value(item, "aria-controls") === '"pdf-context-panel"');
assert.ok(toggle, "a persistent options toggle is required");
assert.equal(toggle.parent, toolbar, "options must remain reachable even with the panel unmounted");
assert.equal(value(toggle, "aria-expanded"), "{sheetOpen}");
assert.equal(value(panel, "id"), '"pdf-context-panel"');
assert.equal(value(panel, "aria-labelledby"), '"pdf-context-title"');
assert.match(value(panel, "onKeyDown"), /Escape[\s\S]*collapsePanel\(\)/u, "Escape must minimize the panel");
const close = elements.find((item) => value(item, "aria-label") === '"Minimizar panel"');
assert.ok(close);
assert.match(value(close, "className"), /h-11 min-w-11/u, "the close target stays at least 44px");
assert.match(value(close, "className"), /bg-white.*text-ink/u, "close contrast must not inherit the global dark button background");
assert.match(close.getText(source), /IconX className="h-4 w-4 shrink-0"/u, "the close icon needs explicit dimensions");
const confirm = elements.find((item) => item.openingElement.tagName.getText(source) === "Button" && value(item, "onClick").includes("confirmPdf()"));
assert.ok(confirm);
assert.equal(value(confirm, "size"), '"sm"', "confirmation uses compact horizontal padding");
assert.ok(value(confirm, "className").includes("[--control-height-sm:2.75rem]"), "override the shared button height token rather than competing min-height utilities");

// Execute the authored handlers without React or a browser; this does not prove layout.
assert.ok(collapseHandler);
let sheetOpen = true;
let focusCount = 0;
const bindings = {
  setSheetOpen: (next) => { sheetOpen = typeof next === "function" ? next(sheetOpen) : next; },
  panelToggleRef: { current: { focus: () => { focusCount += 1; } } },
};
runInNewContext(`(${collapseHandler.getText(source)})()`, bindings);
assert.equal(sheetOpen, false);
assert.equal(focusCount, 1, "minimizing returns keyboard focus to the persistent toggle");
assert.doesNotMatch(collapseHandler.getText(source), /setSelectedId|setDraftEntries|setNoteText/u, "minimizing must preserve selection and draft inputs");
const toggleHandler = attribute(toggle, "onClick").expression.getText(source);
runInNewContext(`(${toggleHandler})()`, bindings);
assert.equal(sheetOpen, true, "the persistent toggle must reopen options");
runInNewContext(`(${toggleHandler})()`, bindings);
assert.equal(sheetOpen, false, "the persistent toggle must also minimize options");
assert.match(editor, /\[sheetOpen, setSheetOpen\] = useState\(false\)/u, "the document starts with options minimized");
const entries = elements.filter((item) => value(item, "data-pdf-editor") === '"code-entry"');
assert.equal(entries.length, 2, "both existing and new codes need compact rows");
for (const entry of entries) {
  assert.match(value(entry, "className"), /grid-cols-\[minmax\(0,1fr\)_4\.5rem_2\.75rem\]/u);
  assert.deepEqual(entry.children.filter(ts.isJsxElement).map((item) => item.openingElement.tagName.getText(source)), ["select", "button"]);
  assert.equal(entry.children.filter(ts.isJsxSelfClosingElement).filter((item) => item.tagName.getText(source) === "input").length, 1, "quantity shares the code row");
}
const styles = elements.find((item) => item.openingElement.tagName.getText(source) === "details" && value(item, "key") === "{selected.id}");
assert.ok(styles, "secondary code settings must remain available via native disclosure");
assert.equal(value(styles, "open"), "", "secondary code settings start collapsed");
assert.match(styles.getText(source), /Tamaño, color y más[\s\S]*type="range"[\s\S]*LineColorPicker[\s\S]*Eliminar/u);

assert.match(editor, /data-pdf-editor="workspace"/u, "the editor needs an explicit responsive workspace");
assert.match(editor, /data-pdf-editor="desktop-tool-rail"/u, "desktop tools belong in a vertical rail");
assert.match(editor, /data-pdf-editor="mobile-tool-dock"/u, "mobile tools belong in a thumb-friendly bottom dock");
assert.match(editor, /data-pdf-editor="context-panel"/u, "tool options belong in a contextual panel");
assert.match(editor, /lg:w-\[19rem\]/u, "the desktop contextual panel must remain near 300px wide");
assert.match(editor, /aria-label="Deshacer \u00faltimo cambio"/u, "undo must remain accessible");
assert.match(editor, /aria-label="Rehacer \u00faltimo cambio"/u, "redo must remain accessible");
assert.match(editor, /historyGestureMutatedRef/u, "gestures need a mutation guard before committing history");
const gestureStart = editor.match(/const beginHistoryGesture = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/u)?.[1] ?? "";
assert.ok(gestureStart, "the gesture-start transaction must remain explicit");
assert.doesNotMatch(gestureStart, /recordHistory\(\)/u, "pointer-down alone must not clear redo");
assert.match(editor, /historyGestureActiveRef\.current[\s\S]{0,220}!historyGestureMutatedRef\.current[\s\S]{0,220}recordHistory\(\)/u, "the first real gesture mutation must create one checkpoint");
assert.match(editor, /overflow-y-auto[^"\n]*touch-pan-y/u, "all contextual controls must remain touch-scrollable");
assert.match(editor, /renderToolButton\("code", "Código"\)/u);
assert.match(editor, /renderToolButton\("note", "Nota"\)/u);
assert.match(editor, /renderToolButton\("line", "Línea"\)/u);
assert.ok(
  editor.indexOf("Confirmar PDF") < editor.indexOf('data-pdf-editor="workspace"'),
  "Confirmar PDF must remain visible in the compact header before the canvas",
);
assert.doesNotMatch(editor, /max-h-\[40vh\]/u, "the old oversized bottom sheet must be removed");
assert.match(editor, /width: `\$\{zoom \* 100\}%`, maxWidth:/u, "100% zoom must fit the available PDF width");
assert.doesNotMatch(editor, /minWidth:.*BASE_PAGE_WIDTH/u, "do not restore the oversized 64rem minimum");

console.log("[pdf-editor-responsive-static] PASS (JSX contracts and panel handlers; no browser layout assertions)");
