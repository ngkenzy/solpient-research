import { Pool, types } from "pg";

types.setTypeParser(1082,(value)=>value);
types.setTypeParser(1114,(value)=>value.replace(" ","T"));
types.setTypeParser(1184,(value)=>value.replace(" ","T"));

let pool=null;

export function postgresConfigured(){
  return Boolean(process.env.SOLPIENT_DATABASE_URL?.trim());
}

export function getPostgresPool(){
  const connectionString=process.env.SOLPIENT_DATABASE_URL?.trim();
  if(!connectionString)return null;
  if(!pool){
    pool=new Pool({
      connectionString,
      max:Number(process.env.SOLPIENT_DB_POOL_MAX??10),
      idleTimeoutMillis:30000,
      connectionTimeoutMillis:5000,
      application_name:"solpient-worker",
    });
  }
  return pool;
}

export async function pgQuery(sql,values=[]){
  const p=getPostgresPool();
  if(!p)throw new Error("SOLPIENT_DATABASE_URL is not configured.");
  const result=await p.query(sql,values);
  return result.rows;
}

export async function pgMaybeOne(sql,values=[]){
  const rows=await pgQuery(sql,values);
  return rows[0]??null;
}

export async function pgTransaction(work){
  const p=getPostgresPool();
  if(!p)throw new Error("SOLPIENT_DATABASE_URL is not configured.");
  const client=await p.connect();
  try{
    await client.query("begin");
    const result=await work(client);
    await client.query("commit");
    return result;
  }catch(error){
    await client.query("rollback");
    throw error;
  }finally{
    client.release();
  }
}

export async function closePostgresPool(){
  if(pool){
    await pool.end();
    pool=null;
  }
}

export async function insertObject(table,row,{conflict=null,update=true,returning="*"}={}){
  const allowed=/^[a-z_][a-z0-9_]*$/i;
  if(!allowed.test(table))throw new Error("Unsafe table name.");
  const keys=Object.keys(row);
  if(!keys.length)throw new Error("Cannot insert an empty row.");
  for(const key of keys)if(!allowed.test(key))throw new Error("Unsafe column name.");
  const values=keys.map((key)=>row[key]);
  const columns=keys.map((key)=>`"${key}"`).join(",");
  const params=keys.map((_,i)=>"$"+(i+1)).join(",");
  let clause="";
  if(conflict?.length){
    for(const key of conflict)if(!allowed.test(key))throw new Error("Unsafe conflict column.");
    const target=conflict.map((key)=>`"${key}"`).join(",");
    if(update){
      const mutable=keys.filter((key)=>!conflict.includes(key));
      clause=mutable.length
        ? " on conflict("+target+") do update set "+mutable.map((key)=>`"${key}"=excluded."${key}"`).join(",")
        : " on conflict("+target+") do nothing";
    }else clause=" on conflict("+target+") do nothing";
  }
  const sql=`insert into public."${table}"(${columns}) values(${params})${clause} returning ${returning}`;
  return pgMaybeOne(sql,values);
}

export async function updateObject(table,row,whereSql,whereValues=[]){
  const allowed=/^[a-z_][a-z0-9_]*$/i;
  if(!allowed.test(table))throw new Error("Unsafe table name.");
  const keys=Object.keys(row);
  for(const key of keys)if(!allowed.test(key))throw new Error("Unsafe column name.");
  const set=keys.map((key,i)=>`"${key}"=$${i+1}`).join(",");
  const sql=`update public."${table}" set ${set} where ${whereSql}`;
  return pgQuery(sql,[...keys.map((key)=>row[key]),...whereValues]);
}
