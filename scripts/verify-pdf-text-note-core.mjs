import assert from "node:assert/strict";
import { movePdfTextNote, parsePdfTextNotes, resizePdfTextNote, validatePdfTextNotes } from "../src/lib/jobs/pdf-text-note-core.ts";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const sources = [{ id: first, pageCount: 2 }, { id: second, pageCount: 3 }];
const note = { page: 3, sourceDocumentId: second, sourcePage: 1, text: "First line\nSecond line", x: 0.1, y: 0.2, width: 0.4, height: 0.2, fontSizeRatio: 0.02 };

assert.equal(validatePdfTextNotes([note], sources), null);
assert.equal(validatePdfTextNotes([{ ...note, text: "Instalación — José\nSeñal número 2" }], sources), null, "Spanish WinAnsi text and multiline notes must remain intact");
assert.deepEqual(parsePdfTextNotes(JSON.parse(JSON.stringify([note])), sources), [note], "reload-shaped JSON must round-trip");
for (const invalid of [
  [{ ...note, text: " leading" }],
  [{ ...note, text: "a\tb" }],
  [{ ...note, text: "x\n".repeat(20) + "x" }],
  [{ ...note, text: "😀".repeat(2001) }],
  [{ ...note, text: "emoji 😀 is not available in Standard Helvetica" }],
  [{ ...note, page: 2 }],
  [{ ...note, sourcePage: 4 }],
  [{ ...note, width: 0.079 }],
  [{ ...note, height: 0.601 }],
  [{ ...note, x: 0.7, width: 0.4 }],
  [{ ...note, fontSizeRatio: 0.051 }],
  [{ ...note, extra: true }],
]) assert.notEqual(validatePdfTextNotes(invalid, sources), null);
assert.notEqual(validatePdfTextNotes(Array.from({ length: 101 }, () => note), sources), null);
assert.deepEqual(movePdfTextNote(note, 2, -2), { ...note, x: 0.6, y: 0 });
const resized = resizePdfTextNote(note, 0.2, 0.1);
assert.ok(Math.abs(resized.width - 0.6) < 1e-9);
assert.ok(Math.abs(resized.height - 0.3) < 1e-9);
assert.ok(Math.abs(resized.fontSizeRatio - 0.03) < 1e-9, "font ratio must scale proportionally with the limiting box dimension");
const widthDrivenResize = resizePdfTextNote(note, 0.2, 0.01);
assert.ok(Math.abs(widthDrivenResize.width / note.width - widthDrivenResize.height / note.height) < 1e-9);
assert.ok(Math.abs(widthDrivenResize.width / note.width - widthDrivenResize.fontSizeRatio / note.fontSizeRatio) < 1e-9,
  "non-uniform pointer movement must still scale box and text by one factor");
console.log("[pdf-text-note-core] PASS");
