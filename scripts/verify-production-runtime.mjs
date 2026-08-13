import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line=raw.trim(); if(!line||line.startsWith("#")) continue;
    const i=line.indexOf("="); if(i<1) continue;
    const key=line.slice(0,i).trim(); let value=line.slice(i+1).trim();
    if (/^(['"]).*\1$/u.test(value)) value=value.slice(1,-1);
    if(!process.env[key]) process.env[key]=value;
  }
}
loadEnv(new URL("../.env.local",import.meta.url));
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!anonKey||!serviceKey) throw new Error("Missing Supabase test environment");
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const service=createClient(url,serviceKey,options);
const users=[]; const jobs=[]; const objects={"project-files":[],"job-evidence":[]}; let checks=0; let cleanupPassed=false;
const runId=randomBytes(6).toString("hex"); const password=`${randomBytes(18).toString("base64url")}Aa1!`;
function check(value,label,error){assert.ok(value,`${label}${error?` [${error.code??"error"}: ${error.message??"unknown"}]`:""}`);checks++;}
async function ok(label,promise){const result=await promise;check(!result.error,label,result.error);return result.data;}
async function identity(label,role,technicianType="in_house"){
  const email=`production-${runId}-${label}@example.com`;
  const created=await ok(`create ${label}`,service.auth.admin.createUser({email,password,email_confirm:true}));
  const id=created.user.id; users.push(id);
  await ok(`configure ${label}`,service.from("profiles").update({role,is_active:true,full_name:`Production ${label}`,technician_type:technicianType}).eq("id",id));
  const client=createClient(url,anonKey,options); await ok(`sign in ${label}`,client.auth.signInWithPassword({email,password}));
  return {id,client};
}
async function startShift(identity,label){
  const rows=await ok(`${label} starts work shift`,identity.client.rpc("start_technician_shift",{p_no_fuel_today:true,p_fuel_amount:0,p_fuel_photo_path:null}));
  check(rows?.length===1,`${label} shift created`);
}
const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=","base64");
const minimalPdf=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
async function upload(bucket,path,bytes,contentType,client=service,metadata){
  await ok(`upload ${bucket}/${path}`,client.storage.from(bucket).upload(path,bytes,{contentType,upsert:false,metadata}));
  objects[bucket].push(path);
}
async function deliver(client,adminClient,jobId,technicianId,catalogId){
  const originalPath=`${jobId}/production-original.pdf`;
  await upload("project-files",originalPath,minimalPdf,"application/pdf");
  await ok("attach production original",adminClient.from("jobs").update({project_pdf_url:originalPath}).eq("id",jobId));
  const originalHash=createHash("sha256").update(minimalPdf).digest("hex");
  const original=await ok("register production original",service.rpc("ensure_job_original_document",{p_job_id:jobId,p_storage_path:originalPath,p_original_filename:"production-original.pdf",p_size_bytes:minimalPdf.length,p_file_hash:originalHash,p_page_count:1}));
  const sourceDocumentId=original;
  const initialized=await ok("initialize production draft",client.rpc("initialize_job_pdf_draft_v2",{p_job_id:jobId,p_source_document_ids:[sourceDocumentId],p_page_count:1}));
  const placement={id:randomUUID(),catalogId,page:1,sourceDocumentId,sourcePage:1,quantity:100,x:0.1,y:0.1,width:0.2,height:0.08,arrowTipX:0.5,arrowTipY:0.5};
  const draftVersion=await ok("save production draft",client.rpc("save_job_pdf_draft_v2",{p_job_id:jobId,p_expected_version:initialized[0].version,p_placements:[placement]}));
  const snapshotHash=createHash("sha256").update(JSON.stringify([placement])).digest("hex");
  const photoId=randomUUID(); const photoPath=`${jobId}/${randomUUID()}.png`;
  await upload("job-evidence",photoPath,tinyPng,"image/png",client);
  await ok("confirm production evidence",client.from("job_photos").insert({id:photoId,job_id:jobId,storage_path:photoPath,photo_type:"evidence",uploaded_by:technicianId}));
  const deliveredPath=`${jobId}/delivered/${randomUUID()}.pdf`;
  await upload("project-files",deliveredPath,minimalPdf,"application/pdf",service,{generator:"susotech-portal",job_id:jobId,source_photo_ids:photoId,source_document_ids:sourceDocumentId,snapshot_hash:snapshotHash});
  const submitted=await ok("submit production job atomically",client.rpc("confirm_delivered_job_pdf_complete",{p_job_id:jobId,p_storage_path:deliveredPath,p_source_photo_ids:[photoId],p_source_document_ids:[sourceDocumentId],p_submit:true,p_expected_draft_version:draftVersion,p_snapshot_hash:snapshotHash}));
  check(submitted?.[0]?.delivered_status==="enviado_revision","atomic production delivery advances state");
}
async function cleanup(){const errors=[]; for(const bucket of Object.keys(objects)) if(objects[bucket].length&&(await service.storage.from(bucket).remove(objects[bucket])).error) errors.push(bucket); if(jobs.length&&(await service.from("jobs").delete().in("id",jobs)).error) errors.push("jobs"); if(users.length&&(await service.from("technician_shifts").delete().in("technician_id",users)).error) errors.push("shifts"); for(const id of [...users].reverse()) if((await service.auth.admin.deleteUser(id)).error) errors.push("users"); cleanupPassed=!errors.length; if(errors.length) throw new Error(`cleanup failed: ${[...new Set(errors)].join(",")}`);}
async function main(){
  const admin=await identity("admin","admin");
  const supervisor=await identity("supervisor","supervisor");
  const inHouse=await identity("inhouse","tecnico","in_house");
  const contractor=await identity("contractor","tecnico","contractor");

  await startShift(inHouse,"in-house technician");
  await startShift(contractor,"contractor technician");

  const inCatalog=await ok("in-house catalog",inHouse.client.rpc("list_my_production_catalog"));
  const conCatalog=await ok("contractor catalog",contractor.client.rpc("list_my_production_catalog"));
  check(inCatalog.length===59,"in-house sees 59 activities"); check(conCatalog.length===59,"contractor sees 59 activities");
  const inAc=inCatalog.find((row)=>row.code==="AC01"); const conAc=conCatalog.find((row)=>row.code==="AC01");
  check(Number(inAc.unit_rate)===0.65,"AC01 in-house rate is lower"); check(Number(conAc.unit_rate)===0.7,"AC01 contractor rate is higher");

  const jobA=await ok("create in-house job",supervisor.client.from("jobs").insert({title:`In-house ${runId}`}).select("id").single()); jobs.push(jobA.id);
  const jobB=await ok("create contractor job",supervisor.client.from("jobs").insert({title:`Contractor ${runId}`}).select("id").single()); jobs.push(jobB.id);
  await ok("assign in-house",supervisor.client.rpc("assign_jobs_atomic",{job_ids:[jobA.id],new_assignee_type:"technician",new_assignee_id:inHouse.id}));
  await ok("assign contractor",supervisor.client.rpc("assign_jobs_atomic",{job_ids:[jobB.id],new_assignee_type:"technician",new_assignee_id:contractor.id}));
  await ok("start in-house",inHouse.client.from("jobs").update({main_status:"en_progreso"}).eq("id",jobA.id).select("id").single());
  await ok("start contractor",contractor.client.from("jobs").update({main_status:"en_progreso"}).eq("id",jobB.id).select("id").single());

  const direct=await inHouse.client.from("job_production_codes").insert({job_id:jobA.id,code:"AC01",quantity:100,added_by:inHouse.id});
  check(Boolean(direct.error),"direct unpriced insert denied");
  const oldDate="2000-01-01";
  const backdate=await inHouse.client.rpc("add_job_production",{p_job_id:jobA.id,p_catalog_id:inAc.id,p_quantity:100,p_production_date:oldDate,p_notes:null});
  check(Boolean(backdate.error),"technician backdate denied");
  await ok("add in-house production",inHouse.client.rpc("add_job_production",{p_job_id:jobA.id,p_catalog_id:inAc.id,p_quantity:100,p_production_date:null,p_notes:"runtime"}));
  await ok("add contractor production",contractor.client.rpc("add_job_production",{p_job_id:jobB.id,p_catalog_id:conAc.id,p_quantity:100,p_production_date:null,p_notes:"runtime"}));
  const snapshots=await ok("read snapshots",service.from("job_production_codes").select("job_id,technician_type_snapshot,unit_rate_snapshot,amount_snapshot,credited_technician_id").in("job_id",[jobA.id,jobB.id]).order("unit_rate_snapshot"));
  check(snapshots.length===2,"two snapshots created"); check(Number(snapshots[0].amount_snapshot)===65,"in-house amount snapshot"); check(Number(snapshots[1].amount_snapshot)===70,"contractor amount snapshot");

  const directSubmit=await inHouse.client.from("jobs").update({main_status:"enviado_revision"}).eq("id",jobA.id).select("id").single();
  check(Boolean(directSubmit.error),"direct in-house submission denied");
  await deliver(inHouse.client,admin.client,jobA.id,inHouse.id,inAc.id);
  await deliver(contractor.client,admin.client,jobB.id,contractor.id,conAc.id);
  await ok("approve in-house",supervisor.client.from("jobs").update({main_status:"aprobado"}).eq("id",jobA.id).select("id").single());
  const own=await ok("own weekly",inHouse.client.rpc("get_my_weekly_production",{p_reference_date:null}));
  check(own.length===1&&own[0].billing_state==="confirmed","own weekly confirmed and isolated");
  const techReport=await inHouse.client.rpc("get_production_report",{p_start_date:"2026-01-01",p_end_date:"2026-12-31"});
  check(Boolean(techReport.error),"technician office report denied");
  const report=await ok("office report",supervisor.client.rpc("get_production_report",{p_start_date:"2026-01-01",p_end_date:"2026-12-31"}));
  check(report.filter((row)=>[jobA.id,jobB.id].includes(row.job_id)).length===0,"report does not expose unnecessary job id");
  check(report.some((row)=>row.technician_id===inHouse.id&&row.billing_state==="confirmed"),"office sees confirmed line");
  check(report.some((row)=>row.technician_id===contractor.id&&row.billing_state==="pending"),"office sees pending line");

  const denied=await supervisor.client.rpc("set_job_archived_v2",{p_job_id:jobB.id,p_archived:true,p_reason_code:"duplicate_job",p_notes:"runtime"});
  check(Boolean(denied.error),"supervisor cannot archive");
  await ok("admin archives",admin.client.rpc("set_job_archived_v2",{p_job_id:jobB.id,p_archived:true,p_reason_code:"duplicate_job",p_notes:"runtime"}));
  const hidden=await ok("archived hidden from technician",contractor.client.from("jobs").select("id").eq("id",jobB.id));
  check(hidden.length===0,"archived job inaccessible to technician");
  await ok("admin restores",admin.client.rpc("set_job_archived_v2",{p_job_id:jobB.id,p_archived:false,p_reason_code:null,p_notes:null}));
  const visible=await ok("restored visible",contractor.client.from("jobs").select("id").eq("id",jobB.id)); check(visible.length===1,"restored job visible");
}
let failure;
try{await main();}catch(error){failure=error;}
finally{try{await cleanup();}catch(error){failure??=error;}}
if(failure){
  console.error(`[production-runtime] FAIL ${failure.message} cleanup=${cleanupPassed?"passed":"failed"}`);
  process.exitCode=1;
}else{
  console.log(`PASS production/archive runtime checks=${checks} cleanup=passed`);
}
