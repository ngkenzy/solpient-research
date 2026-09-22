import { Pool, types } from "pg";
import process from "node:process";

types.setTypeParser(1082,(value)=>value);
types.setTypeParser(1114,(value)=>value.replace(" ","T"));
types.setTypeParser(1184,(value)=>value.replace(" ","T"));

if(!process.env.SOLPIENT_DATABASE_URL && typeof process.loadEnvFile==="function"){
  try{ process.loadEnvFile(".env.local"); }catch{}
}

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

const columnTypeCache=new Map();

export async function columnTypesForTable(table){
  if(columnTypeCache.has(table))return columnTypeCache.get(table);
  const rows=await pgQuery(
    `select column_name,data_type,udt_name
     from information_schema.columns
     where table_schema='public' and table_name=$1`,
    [table],
  );
  const map=new Map(rows.map((row)=>[row.column_name,{data_type:row.data_type,udt_name:row.udt_name}]));
  columnTypeCache.set(table,map);
  return map;
}

const primaryKeyCache=new Map();

export async function primaryKeyColumnsForTable(table){
  if(primaryKeyCache.has(table))return primaryKeyCache.get(table);
  const rows=await pgQuery(`
    select a.attname as column_name
    from pg_index i
    join pg_class c on c.oid=i.indrelid
    join pg_namespace n on n.oid=c.relnamespace
    join unnest(i.indkey) with ordinality as k(attnum,ord) on true
    join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
    where n.nspname='public' and c.relname=$1 and i.indisprimary
    order by k.ord
  `,[table]);
  const cols=rows.map((row)=>row.column_name);
  primaryKeyCache.set(table,cols);
  return cols;
}

export function prepareDbValue(value,typeInfo){
  if(value===undefined)return null;
  if(value===null)return null;
  const type=typeInfo?.data_type;
  if((type==="json"||type==="jsonb")&&(typeof value==="object")){
    return JSON.stringify(value);
  }
  return value;
}

export async function prepareDbRow(table,row){
  const types=await columnTypesForTable(table);
  return Object.fromEntries(
    Object.entries(row).map(([key,value])=>[key,prepareDbValue(value,types.get(key))])
  );
}

export async function insertObject(table,row,{conflict=null,update=true,returning="*"}={}){
  const allowed=/^[a-z_][a-z0-9_]*$/i;
  row=await prepareDbRow(table,row);
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
  row=await prepareDbRow(table,row);
  if(!allowed.test(table))throw new Error("Unsafe table name.");
  const keys=Object.keys(row);
  for(const key of keys)if(!allowed.test(key))throw new Error("Unsafe column name.");
  const set=keys.map((key,i)=>`"${key}"=$${i+1}`).join(",");
  const sql=`update public."${table}" set ${set} where ${whereSql}`;
  return pgQuery(sql,[...keys.map((key)=>row[key]),...whereValues]);
}

export async function upsertObjects(table,rows,{conflict=[],ignoreDuplicates=false,returning=null,batchSize=400}={}){
  if(!rows?.length)return [];
  const allowed=/^[a-z_][a-z0-9_]*$/i;
  if(!allowed.test(table))throw new Error("Unsafe table name.");
  const out=[];
  for(let offset=0;offset<rows.length;offset+=batchSize){
    const rawBatch=rows.slice(offset,offset+batchSize);
    const batch=await Promise.all(rawBatch.map((row)=>prepareDbRow(table,row)));
    const keys=[...new Set(batch.flatMap((row)=>Object.keys(row)))];
    for(const key of keys)if(!allowed.test(key))throw new Error("Unsafe column name.");
    const values=[];
    const tuples=batch.map((row)=>{
      const fields=keys.map((key)=>{
        values.push(row[key]??null);
        return "$"+values.length;
      });
      return "("+fields.join(",")+")";
    });
    let clause="";
    if(conflict.length){
      for(const key of conflict)if(!allowed.test(key))throw new Error("Unsafe conflict column.");
      const target=conflict.map((key)=>`"${key}"`).join(",");
      if(ignoreDuplicates){
        clause=" on conflict("+target+") do nothing";
      }else{
        const mutable=keys.filter((key)=>!conflict.includes(key));
        clause=mutable.length
          ?" on conflict("+target+") do update set "+mutable.map((key)=>`"${key}"=excluded."${key}"`).join(",")
          :" on conflict("+target+") do nothing";
      }
    }
    const returnClause=returning?" returning "+returning:"";
    const sql=`insert into public."${table}"(${keys.map((key)=>`"${key}"`).join(",")}) values ${tuples.join(",")}${clause}${returnClause}`;
    const result=await pgQuery(sql,values);
    out.push(...result);
  }
  return out;
}
