import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root=process.cwd();
const envFile=path.join(root,".env.local");
const lockDir=path.join(root,".cache","group-a-sec-worker.lock");
const logDir=path.join(root,".cache","group-a-sec-worker");
const logFile=path.join(logDir,"worker.log");

function log(message){
  const line=`[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  return fs.appendFile(logFile,line).catch(()=>{});
}

async function loadEnvFile(){
  if(!fsSync.existsSync(envFile))return;
  const body=await fs.readFile(envFile,"utf8");
  for(const raw of body.split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith("#"))continue;
    const i=line.indexOf("=");
    if(i<=0)continue;
    const key=line.slice(0,i).trim();
    let value=line.slice(i+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))){
      value=value.slice(1,-1);
    }
    if(process.env[key]===undefined)process.env[key]=value;
  }
}

function run(script){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script],{
      cwd:root,
      env:process.env,
      stdio:["ignore","pipe","pipe"],
    });
    child.stdout.on("data",chunk=>{
      process.stdout.write(chunk);
      fs.appendFile(logFile,chunk).catch(()=>{});
    });
    child.stderr.on("data",chunk=>{
      process.stderr.write(chunk);
      fs.appendFile(logFile,chunk).catch(()=>{});
    });
    child.on("error",reject);
    child.on("close",code=>{
      if(code===0)resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

await fs.mkdir(logDir,{recursive:true});
await loadEnvFile();

process.env.SUPABASE_URL=
  process.env.SUPABASE_URL?.trim()||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()||
  "";
process.env.SUPABASE_SERVICE_ROLE_KEY=
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()||
  process.env.SUPABASE_SECRET_KEY?.trim()||
  "";

if(!process.env.SUPABASE_URL)throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in .env.local.");
if(!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY in .env.local.");
if(!process.env.SEC_CONTACT&&!process.env.SEC_USER_AGENT){
  throw new Error("Missing SEC_CONTACT or SEC_USER_AGENT in .env.local.");
}

try{
  await fs.mkdir(path.dirname(lockDir),{recursive:true});
  await fs.mkdir(lockDir);
}catch(error){
  if(error?.code==="EEXIST"){
    throw new Error("Group A SEC worker is already running (lock exists at "+lockDir+").");
  }
  throw error;
}

const started=new Date().toISOString();
try{
  await log("SEC worker started.");
  await run("scripts/monitor-sec.mjs");
  await run("scripts/sync-sec-monitor-state.mjs");
  await log("SEC worker completed successfully.");
  await fs.writeFile(
    path.join(logDir,"last-success.json"),
    JSON.stringify({started_at:started,completed_at:new Date().toISOString(),status:"success"},null,2)+"\n"
  );
}catch(error){
  await log("SEC worker FAILED: "+(error instanceof Error?error.message:String(error)));
  await fs.writeFile(
    path.join(logDir,"last-failure.json"),
    JSON.stringify({
      started_at:started,
      failed_at:new Date().toISOString(),
      status:"failed",
      error:error instanceof Error?error.message:String(error),
    },null,2)+"\n"
  );
  throw error;
}finally{
  await fs.rm(lockDir,{recursive:true,force:true});
}
