import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFArray, PDFDocument, PDFName, rgb } from "pdf-lib";
import sharp from "sharp";

const repo = process.cwd();
const scratch = path.join(repo, "tmp", "pdfs", `flatten-source-${process.pid}-${randomBytes(4).toString("hex")}`);
const modulePath = path.join(scratch, "delivered-pdf.ts");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function countPixels({ data, info }, matches) {
  let count = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (matches(data[index], data[index + 1], data[index + 2])) count += 1;
  }
  return count;
}

function addVisibleAnnotation(document, page) {
  const appearance = document.context.register(document.context.stream(
    "q 1 0 1 rg 0 0 180 70 re f 0 0 0 RG 2 w 0 0 180 70 re S Q",
    {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      BBox: [0, 0, 180, 70],
      Resources: {},
    },
  ));
  const annotation = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Square",
    Rect: [70, 160, 250, 230],
    F: 4,
    AP: { N: appearance },
  }));
  page.node.addAnnot(annotation);
}

await mkdir(scratch, { recursive: true });
try {
  const source = await readFile(path.join(repo, "src", "lib", "jobs", "delivered-pdf.ts"), "utf8");
  await writeFile(modulePath, source.replace(/import "server-only";\r?\n/u, ""));
  const { composeDeliveredPdf, flattenSourceDocuments, renderOriginalPdfPreview } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

  const first = await PDFDocument.create();
  const firstPage = first.addPage([300, 400]);
  firstPage.drawRectangle({ x: 20, y: 300, width: 80, height: 60, color: rgb(1, 0, 0) });
  addVisibleAnnotation(first, firstPage);
  const firstBytes = await first.save({ useObjectStreams: false });
  const firstHash = hash(firstBytes);
  const firstReloaded = await PDFDocument.load(firstBytes);
  assert.ok(
    firstReloaded.getPages()[0].node.lookupMaybe(PDFName.of("Annots"), PDFArray),
    "synthetic source has a visible widget annotation",
  );

  const second = await PDFDocument.create();
  const secondPage = second.addPage([400, 300]);
  secondPage.drawRectangle({ x: 300, y: 20, width: 70, height: 80, color: rgb(0, 0, 1) });
  const secondBytes = await second.save({ useObjectStreams: false });
  const secondHash = hash(secondBytes);

  const sourceIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const sourcePreview = await renderOriginalPdfPreview(firstBytes, 1);
  const sourcePixels = await sharp(sourcePreview.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceAnnotationPixels = countPixels(sourcePixels, (red, green, blue) => red > 180 && blue > 180 && green < 100);
  assert.ok(sourceAnnotationPixels > 1_000, `synthetic annotation renders before flattening (pixels=${sourceAnnotationPixels})`);
  const flattened = await flattenSourceDocuments([
    { id: sourceIds[0], bytes: firstBytes },
    { id: sourceIds[1], bytes: secondBytes },
  ]);
  assert.equal(hash(firstBytes), firstHash, "flattening does not change the first source bytes");
  assert.equal(hash(secondBytes), secondHash, "flattening does not change the second source bytes");
  assert.equal(flattened.pageCount, 2, "flattening preserves the combined source page count");
  assert.deepEqual(flattened.sourceDocumentIds, sourceIds, "flattening preserves verified source order");

  const flattenedDocument = await PDFDocument.load(flattened.bytes);
  assert.equal(flattenedDocument.getPageCount(), 2, "flattened PDF reopens with both pages");
  const flattenedAnnotations = flattenedDocument.getPages()[0].node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  assert.ok(
    !flattenedAnnotations || flattenedAnnotations.size() === 0,
    "flattened PDF contains raster page content instead of source annotations",
  );

  const [firstPreview, secondPreview] = await Promise.all([
    renderOriginalPdfPreview(flattened.bytes, 1),
    renderOriginalPdfPreview(flattened.bytes, 2),
  ]);
  const firstPixels = await sharp(firstPreview.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const secondPixels = await sharp(secondPreview.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const redOnFirst = countPixels(firstPixels, (red, green, blue) => red > 180 && green < 80 && blue < 80);
  const blueOnFirst = countPixels(firstPixels, (red, green, blue) => blue > 180 && red < 80 && green < 80);
  const magentaAnnotation = countPixels(firstPixels, (red, green, blue) => red > 180 && blue > 180 && green < 100);
  const redOnSecond = countPixels(secondPixels, (red, green, blue) => red > 180 && green < 80 && blue < 80);
  const blueOnSecond = countPixels(secondPixels, (red, green, blue) => blue > 180 && red < 80 && green < 80);
  assert.ok(redOnFirst > 1_000 && blueOnFirst < 100, "first verified source page remains first");
  assert.ok(blueOnSecond > 1_000 && redOnSecond < 100, "second verified source page remains second");
  assert.ok(magentaAnnotation > 1_000, `visible source annotation is present in the flattened page image (pixels=${magentaAnnotation})`);

  const evidence = await sharp(Buffer.from('<svg width="300" height="200"><rect width="300" height="200" fill="#dddddd"/></svg>')).jpeg().toBuffer();
  const delivered = await composeDeliveredPdf(
    [{ id: sourceIds[0], bytes: firstBytes }, { id: sourceIds[1], bytes: secondBytes }],
    [{ id: "33333333-3333-4333-8333-333333333333", bytes: evidence }],
  );
  assert.equal(delivered.originalPageCount, 2, "delivery preserves both source pages");
  assert.equal(delivered.pageCount, 3, "delivery appends evidence after flattened source pages");
  const deliveredPreview = await renderOriginalPdfPreview(delivered.bytes, 1);
  const deliveredPixels = await sharp(deliveredPreview.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(
    countPixels(deliveredPixels, (red, green, blue) => red > 180 && blue > 180 && green < 100) > 1_000,
    "delivery retains visible source annotations after rasterization",
  );

  console.log(JSON.stringify({
    result: "PASS",
    pageCount: flattened.pageCount,
    sourceDocumentIds: flattened.sourceDocumentIds,
    outputBytes: flattened.bytes.length,
    deliveredPageCount: delivered.pageCount,
    sourceAnnotationPixels,
    magentaAnnotationPixels: magentaAnnotation,
  }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
