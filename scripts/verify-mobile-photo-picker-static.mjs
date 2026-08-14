import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evidence = readFileSync("src/components/jobs/photo-upload.tsx", "utf8");
const shift = readFileSync(
  "src/components/work-shifts/start-shift-form.tsx",
  "utf8",
);

for (const [name, source] of [
  ["job evidence", evidence],
  ["shift fuel", shift],
]) {
  assert.match(source, /const cameraInput = useRef<HTMLInputElement>\(null\)/);
  assert.match(source, /const galleryInput = useRef<HTMLInputElement>\(null\)/);
  assert.match(source, /useState<File \| null>\(null\)/);
  assert.match(source, /const MAX_PHOTO_BYTES = 10 \* 1024 \* 1024/);
  assert.equal(
    (source.match(/accept="image\/jpeg,image\/png,image\/webp"/gu) ?? []).length,
    2,
    `${name} must expose two identically restricted image inputs`,
  );
  assert.equal(
    (source.match(/capture="environment"/gu) ?? []).length,
    1,
    `${name} must apply capture only to the camera input`,
  );
  assert.match(source, />\s*Tomar foto\s*</u);
  assert.match(source, />\s*Elegir de galería\s*</u);
  assert.match(source, /event\.currentTarget\.value = ""/);
  assert.match(source, /const clearPhoto = \(\) =>/);
  assert.match(source, /cameraInput\.current\.value = ""/);
  assert.match(source, /galleryInput\.current\.value = ""/);
  assert.match(source, /onClick=\{clearPhoto\}/);
  assert.match(source, /grid gap-3 sm:grid-cols-2/);
}

assert.match(evidence, /const \[photo, setPhoto\] = useState<File \| null>\(null\)/);
assert.match(evidence, /if \(!prepared\.success\) \{[\s\S]*?return;[\s\S]*?\}/u);
assert.match(evidence, /if \(error\) \{[\s\S]*?Puedes reintentar\.[\s\S]*?return;/u);
assert.match(evidence, /if \(confirmed\.success\) \{\s*clearPhoto\(\)/u);

assert.match(shift, /if \(result\.success\) \{\s*clearPhoto\(\)/u);
assert.match(shift, /No se pudo subir la foto\. Puedes reintentar\./u);

console.log("PASS mobile camera/gallery picker static checks");
