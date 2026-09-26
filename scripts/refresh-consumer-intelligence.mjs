import { createClient } from "@supabase/supabase-js";

const url=(process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??"").trim();
const key=(
  process.env.SUPABASE_SECRET_KEY?.trim()
  ||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ||""
);

if(!url||!key){
  throw new Error("Missing SUPABASE_URL and server secret.");
}

const expectedProjectRef=(process.env.SOLPIENT_PRODUCTION_PROJECT_REF??"hmfrlpsjszjpvzogrico").trim();
const actualProjectRef=new URL(url).hostname.split(".")[0];

if(expectedProjectRef&&actualProjectRef!==expectedProjectRef){
  throw new Error(
    "Refusing consumer refresh for unexpected Supabase project: "
      +actualProjectRef+" (expected "+expectedProjectRef+")."
  );
}

const batchSize=Math.min(
  Math.max(Number(process.env.CONSUMER_REFRESH_BATCH_SIZE??200)||200,1),
  1000
);

const maxPages=Math.min(
  Math.max(Number(process.env.CONSUMER_REFRESH_MAX_PAGES??20)||20,1),
  100
);

const supabase=createClient(url,key,{
  auth:{persistSession:false,autoRefreshToken:false},
});

let afterUserId=null;
let processedUsers=0;
let alertRefreshOk=0;
let digestRefreshReady=0;
let errorCount=0;
let pages=0;

for(;pages<maxPages;pages+=1){
  const {data,error}=await supabase.rpc(
    "refresh_consumer_intelligence_batch_v1",
    {
      p_user_limit:batchSize,
      p_after_user_id:afterUserId,
    }
  );

  if(error){
    throw new Error(
      [
        error.code,
        error.message,
        error.details,
        error.hint,
      ].filter(Boolean).join(" | ")
    );
  }

  const result=data??{};
  processedUsers+=Number(result.processed_users??0);
  alertRefreshOk+=Number(result.alert_refresh_ok??0);
  digestRefreshReady+=Number(result.digest_refresh_ready??0);
  errorCount+=Number(result.error_count??0);

  const lastUserId=result.last_user_id??null;
  const hasMore=Boolean(result.has_more);

  if(!hasMore||!lastUserId)break;
  if(lastUserId===afterUserId){
    throw new Error("Consumer refresh cursor did not advance.");
  }
  afterUserId=lastUserId;
}

const summary={
  status:errorCount===0?"success":"partial",
  pages:pages+1,
  processed_users:processedUsers,
  alert_refresh_ok:alertRefreshOk,
  digest_refresh_ready:digestRefreshReady,
  error_count:errorCount,
  completed_at:new Date().toISOString(),
};

console.log(JSON.stringify(summary,null,2));

if(errorCount>0){
  process.exitCode=1;
}
