import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { codeColor, validatePlacements } from "../src/lib/jobs/pdf-code-editor-core.ts";

const placement={id:"11111111-1111-4111-8111-111111111111",catalogId:"22222222-2222-4222-8222-222222222222",sourceDocumentId:"55555555-5555-4555-8555-555555555555",sourcePage:1,quantity:12.5,page:1,x:0.12,y:0.18,width:0.18,height:0.07,arrowTipX:.45,arrowTipY:.3};
assert.equal(validatePlacements([placement],2),null);
assert.match(validatePlacements([placement,{...placement,id:"33333333-3333-4333-8333-333333333333",x:0.15}],2),/superpuestos/u);
assert.notEqual(validatePlacements([{...placement,x:Number.NaN}],2),null);
assert.notEqual(validatePlacements([placement,{...placement,x:.5}],2),null);
assert.equal(codeColor("AS01"),codeColor("as01"));

const scratch=path.join(process.cwd(),"tmp","pdfs","code-editor-runtime"); await mkdir(scratch,{recursive:true});
const modulePath=path.join(scratch,"delivered-pdf.ts");
try {
  const source=await readFile(path.join(process.cwd(),"src/lib/jobs/delivered-pdf.ts"),"utf8");
  await writeFile(modulePath,source.replace(/import "server-only";\r?\n/u,""));
  const {composeDeliveredPdf,renderOriginalPdfPreview}=await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
  const original=await PDFDocument.create(); const font=await original.embedFont(StandardFonts.Helvetica);
  const first=original.addPage([612,792]); first.drawText("REPRESENTATIVE ORIGINAL - PAGE 1",{x:48,y:730,size:20,font,color:rgb(0,0,0)}); first.drawRectangle({x:45,y:100,width:520,height:580,borderWidth:2,borderColor:rgb(.2,.2,.2)});
  const originalBytes=await original.save({useObjectStreams:false});
  const additional=await PDFDocument.create(); const additionalFont=await additional.embedFont(StandardFonts.Helvetica);
  const second=additional.addPage([792,612]); second.drawText("ADDITIONAL SOURCE - PAGE 1",{x:50,y:550,size:24,font:additionalFont});
  const additionalBytes=await additional.save({useObjectStreams:false});
  const evidence=await sharp(Buffer.from('<svg width="800" height="600"><rect width="800" height="600" fill="#ddd"/><text x="80" y="300" font-size="64">EVIDENCE PHOTO</text></svg>')).jpeg().toBuffer();
  const additionalId="66666666-6666-4666-8666-666666666666";
  const delivered=await composeDeliveredPdf([{id:placement.sourceDocumentId,bytes:originalBytes},{id:additionalId,bytes:additionalBytes}],[{id:"44444444-4444-4444-8444-444444444444",bytes:evidence}], [{...placement,code:"AS01",color:codeColor("AS01")},{...placement,page:2,sourceDocumentId:additionalId,sourcePage:1,x:.55,y:.4,arrowTipX:.85,arrowTipY:.55,code:"US40-A",color:codeColor("US40-A")}]);
  const pdfPath=path.join(scratch,"representative-code-delivery.pdf"); await writeFile(pdfPath,delivered.bytes);
  const previews=[]; for(let page=1;page<=3;page+=1){const rendered=await renderOriginalPdfPreview(delivered.bytes,page); const output=path.join(scratch,`representative-code-delivery-page-${page}.png`); await writeFile(output,rendered.png); previews.push({rendered,output});}
  const preview=previews[0].rendered; const pngPath=previews[0].output;
  assert.equal(delivered.originalPageCount,2); assert.equal(delivered.pageCount,3); assert.ok(preview.png.length>10000);
  assert.deepEqual(delivered.sourceDocumentIds,[placement.sourceDocumentId,additionalId]);
  const {data:pixels,info}=await sharp(preview.png).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let greenPixels=0; for(let index=0;index<pixels.length;index+=info.channels){if(pixels[index+1]>pixels[index]*1.25&&pixels[index+1]>pixels[index+2]*1.25&&pixels[index+1]>100)greenPixels+=1;}
  assert.ok(greenPixels>500,"flattened code keeps its stable color");
  await rm(modulePath,{force:true});
  console.log(JSON.stringify({result:"PASS",pdfPath,pngPath,pageCount:delivered.pageCount,bytes:delivered.bytes.length}));
} catch(error) { await rm(modulePath,{force:true}); throw error; }
