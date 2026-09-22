import { pgQuery, pgMaybeOne, postgresConfigured, prepareDbRow, primaryKeyColumnsForTable } from "./postgres-node.mjs";

const safeIdent=/^[a-z_][a-z0-9_]*$/i;
const quote=(value)=>{
  if(!safeIdent.test(value))throw new Error("Unsafe SQL identifier: "+value);
  return '"'+value+'"';
};
function splitTopLevel(value){
  const out=[];let depth=0,start=0;
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(c==="(")depth++;
    else if(c===")")depth--;
    else if(c===","&&depth===0){out.push(value.slice(start,i).trim());start=i+1;}
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}
function plainColumns(spec){
  if(!spec||spec==="*")return "*";
  const parts=splitTopLevel(spec).filter(x=>!x.includes("("));
  return parts.length?parts.map(x=>{
    const [col,alias]=x.split(":").map(v=>v.trim());
    if(alias)return quote(alias)+" as "+quote(col);
    return quote(col);
  }).join(","):"*";
}
function err(error){
  const message=error instanceof Error
    ? error.message
    : (error?.message??JSON.stringify(error??{}));
  const wrapped=new Error(message);
  wrapped.name="PostgresCompatError";
  wrapped.code=error?.code??null;
  wrapped.details=error?.detail??error?.details??null;
  wrapped.detail=error?.detail??error?.details??null;
  wrapped.hint=error?.hint??null;
  wrapped.schema=error?.schema??null;
  wrapped.table=error?.table??null;
  wrapped.column=error?.column??null;
  wrapped.constraint=error?.constraint??null;
  wrapped.dataType=error?.dataType??null;
  wrapped.where=error?.where??null;
  wrapped.cause=error;
  return wrapped;
}
function normalizeRows(value){return Array.isArray(value)?value:[value];}

class PgBuilder{
  constructor(table){
    if(!safeIdent.test(table))throw new Error("Unsafe table name: "+table);
    this.table=table;
    this.op="select";
    this.columns="*";
    this.returning=null;
    this.rows=null;
    this.patch=null;
    this.filters=[];
    this.orders=[];
    this.limitValue=null;
    this.offsetValue=null;
    this.countMode=null;
    this.head=false;
    this.conflict=[];
    this.ignoreDuplicates=false;
  }
  select(columns="*",options={}){
    if(this.op==="select")this.columns=columns;
    else this.returning=columns;
    this.countMode=options?.count??this.countMode;
    this.head=Boolean(options?.head);
    return this;
  }
  insert(rows){this.op="insert";this.rows=normalizeRows(rows);return this;}
  upsert(rows,options={}){
    this.op="upsert";this.rows=normalizeRows(rows);
    this.conflict=String(options?.onConflict??"").split(",").map(x=>x.trim()).filter(Boolean);
    this.ignoreDuplicates=Boolean(options?.ignoreDuplicates);
    return this;
  }
  update(patch){this.op="update";this.patch=patch??{};return this;}
  delete(){this.op="delete";return this;}
  eq(column,value){this.filters.push({column,op:"=",value});return this;}
  neq(column,value){this.filters.push({column,op:"<>",value});return this;}
  lt(column,value){this.filters.push({column,op:"<",value});return this;}
  lte(column,value){this.filters.push({column,op:"<=",value});return this;}
  gt(column,value){this.filters.push({column,op:">",value});return this;}
  gte(column,value){this.filters.push({column,op:">=",value});return this;}
  in(column,values){this.filters.push({column,op:"in",value:values});return this;}
  is(column,value){this.filters.push({column,op:"is",value});return this;}
  not(column,operator,value){this.filters.push({column,op:"not:"+operator,value});return this;}
  order(column,options={}){
    this.orders.push({column,ascending:options?.ascending!==false,nullsFirst:options?.nullsFirst});
    return this;
  }
  limit(value){this.limitValue=Number(value);return this;}
  range(from,to){this.offsetValue=Number(from);this.limitValue=Number(to)-Number(from)+1;return this;}
  async single(){return this.execute("single");}
  async maybeSingle(){return this.execute("maybeSingle");}
  then(resolve,reject){return this.execute("many").then(resolve,reject);}

  buildWhere(values,startIndex=1){
    if(!this.filters.length)return {sql:"",values,next:startIndex};
    const clauses=[];
    let idx=startIndex;
    for(const f of this.filters){
      const col=quote(f.column);
      if(f.op==="in"){
        values.push((f.value??[]).map((value)=>String(value)));
        clauses.push(col+"::text=any($"+idx+"::text[])");
        idx++;
      }else if(f.op==="is"){
        if(f.value===null)clauses.push(col+" is null");
        else {values.push(f.value);clauses.push(col+" is not distinct from $"+idx);idx++;}
      }else if(f.op==="not:is"&&f.value===null){
        clauses.push(col+" is not null");
      }else{
        values.push(f.value);
        clauses.push(col+" "+f.op+" $"+idx);
        idx++;
      }
    }
    return {sql:" where "+clauses.join(" and "),values,next:idx};
  }
  orderLimit(){
    let sql="";
    if(this.orders.length){
      sql+=" order by "+this.orders.map(o=>{
        let x=quote(o.column)+(o.ascending?" asc":" desc");
        if(o.nullsFirst===true)x+=" nulls first";
        if(o.nullsFirst===false)x+=" nulls last";
        return x;
      }).join(",");
    }
    if(Number.isFinite(this.limitValue))sql+=" limit "+Math.max(0,this.limitValue);
    if(Number.isFinite(this.offsetValue))sql+=" offset "+Math.max(0,this.offsetValue);
    return sql;
  }
  async execute(mode){
    try{
      let sql="",values=[];
      if(this.op==="select"){
        const where=this.buildWhere(values,1);
        values=where.values;
        if(this.countMode==="exact"&&this.head){
          sql=`select count(*)::int as count from public.${quote(this.table)}${where.sql}`;
          const row=await pgMaybeOne(sql,values);
          return {data:null,error:null,count:row?.count??0};
        }
        sql=`select ${plainColumns(this.columns)} from public.${quote(this.table)}${where.sql}${this.orderLimit()}`;
      }else if(this.op==="insert"||this.op==="upsert"){
        const rawRows=this.rows??[];
        if(!rawRows.length)return {data:[],error:null};
        const rows=await Promise.all(rawRows.map((row)=>prepareDbRow(this.table,row)));
        const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
        keys.forEach(quote);
        const tuples=rows.map(row=>"("+keys.map(key=>{values.push(row[key]??null);return "$"+values.length;}).join(",")+")");
        sql=`insert into public.${quote(this.table)}(${keys.map(quote).join(",")}) values ${tuples.join(",")}`;
        if(this.op==="upsert"){
          const conflict=this.conflict.length?this.conflict:await primaryKeyColumnsForTable(this.table);
          if(conflict.length){
            conflict.forEach(quote);
            const target=conflict.map(quote).join(",");
            if(this.ignoreDuplicates)sql+=` on conflict(${target}) do nothing`;
            else{
              const mutable=keys.filter(k=>!conflict.includes(k));
              sql+=mutable.length
                ?` on conflict(${target}) do update set ${mutable.map(k=>quote(k)+"=excluded."+quote(k)).join(",")}`
                :` on conflict(${target}) do nothing`;
            }
          }
        }
        if(this.returning)sql+=" returning "+plainColumns(this.returning);
      }else if(this.op==="update"){
        const preparedPatch=await prepareDbRow(this.table,this.patch??{});
        const keys=Object.keys(preparedPatch);
        const set=keys.map(key=>{values.push(preparedPatch[key]);return quote(key)+"=$"+values.length;}).join(",");
        const where=this.buildWhere(values,values.length+1);
        values=where.values;
        sql=`update public.${quote(this.table)} set ${set}${where.sql}`;
        if(this.returning)sql+=" returning "+plainColumns(this.returning);
      }else if(this.op==="delete"){
        const where=this.buildWhere(values,1);values=where.values;
        sql=`delete from public.${quote(this.table)}${where.sql}`;
        if(this.returning)sql+=" returning "+plainColumns(this.returning);
      }

      const data=await pgQuery(sql,values);
      if(mode==="single"){
        if(data.length!==1)return {data:data[0]??null,error:{message:"Expected exactly one row."}};
        return {data:data[0],error:null};
      }
      if(mode==="maybeSingle"){
        if(data.length>1)return {data:null,error:{message:"Expected zero or one row."}};
        return {data:data[0]??null,error:null};
      }
      return {data,error:null,count:this.countMode==="exact"?data.length:null};
    }catch(error){
      return {data:null,error:err(error),count:null};
    }
  }
}

const rpcCache=new Map();
async function rpcSignature(name,argNames){
  const key=name+"|"+argNames.join(",");
  if(rpcCache.has(key))return rpcCache.get(key);
  const rows=await pgQuery(`
    select p.proargnames,
           array(select format_type(x,null) from unnest(p.proargtypes::oid[]) x) as argtypes
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=$1
    order by p.oid
  `,[name]);
  const match=rows.find(row=>{
    const names=(row.proargnames??[]).slice(0,(row.argtypes??[]).length);
    return argNames.every(x=>names.includes(x));
  })??rows[0];
  if(!match)throw new Error("PostgreSQL function not found: "+name);
  const names=(match.proargnames??[]).slice(0,(match.argtypes??[]).length);
  const map=new Map(names.map((n,i)=>[n,match.argtypes[i]]));
  rpcCache.set(key,map);return map;
}
function pgValue(value,type){
  if((type==="json"||type==="jsonb")&&(Array.isArray(value)||value&&typeof value==="object"))return JSON.stringify(value);
  return value;
}

export function createPostgresCompatClient(){
  if(!postgresConfigured())throw new Error("SOLPIENT_DATABASE_URL is not configured.");
  return {
    from(table){return new PgBuilder(table);},
    async rpc(name,args={}){
      try{
        if(!safeIdent.test(name))throw new Error("Unsafe function name.");
        const entries=Object.entries(args);
        const types=await rpcSignature(name,entries.map(([key])=>key));
        const values=[];
        const named=entries.map(([key,value],i)=>{
          if(!safeIdent.test(key))throw new Error("Unsafe function argument.");
          const type=types.get(key)??"text";
          values.push(pgValue(value,type));
          return quote(key)+" => $"+(i+1)+"::"+type;
        });
        const row=await pgMaybeOne(`select public.${quote(name)}(${named.join(",")}) as data`,values);
        return {data:row?.data??null,error:null};
      }catch(error){
        return {data:null,error:err(error)};
      }
    },
  };
}
