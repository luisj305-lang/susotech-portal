import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
const users=[]; const jobs=[]; let checks=0; let cleanupPassed=false;
const runId=randomBytes(6).toString("hex"); const password=`${randomBytes(18).toString("base64url")}Aa1!`;
function check(value,label,error){assert.ok(value,`${label}${error?` [${error.code??error.message}]`:""}`);checks++;}
async function ok(label,promise){const result=await promise;check(!result.error,label,result.error);return result.data;}
async function identity(label,role,technicianType="in_house"){
  const email=`production-${runId}-${label}@example.com`;
  const created=await ok(`create ${label}`,service.auth.admin.createUser({email,password,email_confirm:true}));
  const id=created.user.id; users.push(id);
  await ok(`configure ${label}`,service.from("profiles").update({role,is_active:true,full_name:`Production ${label}`,technician_type:technicianType}).eq("id",id));
  const client=createClient(url,anonKey,options); await ok(`sign in ${label}`,client.auth.signInWithPassword({email,password}));
  return {id,client};
}
async function cleanup(){const errors=[]; if(jobs.length&&(await service.from("jobs").delete().in("id",jobs)).error) errors.push("jobs"); for(const id of [...users].reverse()) if((await service.auth.admin.deleteUser(id)).error) errors.push("users"); cleanupPassed=!errors.length; if(errors.length) throw new Error(`cleanup failed: ${errors.join(",")}`);}
async function main(){
  const admin=await identity("admin","admin");
  const supervisor=await identity("supervisor","supervisor");
  const inHouse=await identity("inhouse","tecnico","in_house");
  const contractor=await identity("contractor","tecnico","contractor");

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

  await ok("submit in-house",inHouse.client.from("jobs").update({main_status:"enviado_revision"}).eq("id",jobA.id).select("id").single());
  await ok("approve in-house",supervisor.client.from("jobs").update({main_status:"aprobado"}).eq("id",jobA.id).select("id").single());
  const own=await ok("own weekly",inHouse.client.rpc("get_my_weekly_production",{p_reference_date:null}));
  check(own.length===1&&own[0].billing_state==="confirmed","own weekly confirmed and isolated");
  const techReport=await inHouse.client.rpc("get_production_report",{p_start_date:"2026-01-01",p_end_date:"2026-12-31"});
  check(Boolean(techReport.error),"technician office report denied");
  const report=await ok("office report",supervisor.client.rpc("get_production_report",{p_start_date:"2026-01-01",p_end_date:"2026-12-31"}));
  check(report.filter((row)=>[jobA.id,jobB.id].includes(row.job_id)).length===0,"report does not expose unnecessary job id");
  check(report.some((row)=>row.technician_id===inHouse.id&&row.billing_state==="confirmed"),"office sees confirmed line");
  check(report.some((row)=>row.technician_id===contractor.id&&row.billing_state==="pending"),"office sees pending line");

  const denied=await supervisor.client.rpc("set_job_archived",{p_job_id:jobB.id,p_archived:true,p_reason:"runtime"});
  check(Boolean(denied.error),"supervisor cannot archive");
  await ok("admin archives",admin.client.rpc("set_job_archived",{p_job_id:jobB.id,p_archived:true,p_reason:"runtime"}));
  const hidden=await ok("archived hidden from technician",contractor.client.from("jobs").select("id").eq("id",jobB.id));
  check(hidden.length===0,"archived job inaccessible to technician");
  await ok("admin restores",admin.client.rpc("set_job_archived",{p_job_id:jobB.id,p_archived:false,p_reason:null}));
  const visible=await ok("restored visible",contractor.client.from("jobs").select("id").eq("id",jobB.id)); check(visible.length===1,"restored job visible");
}
try{await main();}finally{await cleanup();}
console.log(`PASS production/archive runtime checks=${checks} cleanup=${cleanupPassed?"passed":"failed"}`);
