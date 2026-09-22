const defaultSleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

export function isTransientTransportError(error){
  const message=String(error?.message??error??"");
  return /\b520\b|\b502\b|\b503\b|\b504\b|cloudflare|fetch failed|network/i.test(message);
}

export function chunkResultRows(rows=[],options={}){
  const maxRows=Math.max(1,Number(options.maxRows??25)||25);
  const maxBytes=Math.max(1024,Number(options.maxBytes??180_000)||180_000);
  const chunks=[];
  let current=[];
  let bytes=2;
  let startOrdinal=1;

  for(const row of rows){
    const rowBytes=Buffer.byteLength(JSON.stringify(row),"utf8")+1;
    if(rowBytes>maxBytes){
      throw new Error(
        "A single universe result exceeds the staging payload ceiling for "+
        String(row?.ticker??"unknown")+": "+rowBytes+" bytes."
      );
    }
    if(current.length&&(current.length>=maxRows||bytes+rowBytes>maxBytes)){
      chunks.push({startOrdinal,rows:current,bytes});
      startOrdinal+=current.length;
      current=[];
      bytes=2;
    }
    current.push(row);
    bytes+=rowBytes;
  }
  if(current.length)chunks.push({startOrdinal,rows:current,bytes});
  return chunks;
}

export async function rpcWithTransientRetry(sb,name,args,options={}){
  const maxAttempts=Math.max(1,Number(options.maxAttempts??4)||4);
  const sleep=options.sleep??defaultSleep;
  let lastError=null;

  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const {data,error}=await sb.rpc(name,args);
    if(!error)return data;
    lastError=error;
    if(!isTransientTransportError(error)||attempt===maxAttempts)throw error;
    await sleep(Math.min(500*2**(attempt-1),4000));
  }
  throw lastError??new Error("RPC failed: "+name);
}

export async function publishUniverseScreenStaged({
  sb,
  runPayload,
  resultRows,
  maxRows=25,
  maxBytes=180_000,
  maxAttempts=4,
  sleep,
}={}){
  if(!sb?.rpc)throw new Error("Supabase client with rpc() is required.");
  if(!runPayload||typeof runPayload!=="object")throw new Error("runPayload is required.");
  if(!Array.isArray(resultRows))throw new Error("resultRows must be an array.");

  const begin=await rpcWithTransientRetry(
    sb,
    "begin_universe_screen_publish_v1_2",
    {p_run:runPayload},
    {maxAttempts,sleep}
  );

  let runId=begin?.run_id??null;
  const publishSessionId=begin?.publish_session_id??null;
  let stagedChunkCount=0;

  if(!runId){
    if(!publishSessionId){
      throw new Error("Staged publication did not return a publish session id.");
    }

    const chunks=chunkResultRows(resultRows,{maxRows,maxBytes});
    for(const chunk of chunks){
      await rpcWithTransientRetry(
        sb,
        "stage_universe_screen_results_v1_2",
        {
          p_publish_session_id:publishSessionId,
          p_start_ordinal:chunk.startOrdinal,
          p_results:chunk.rows,
        },
        {maxAttempts,sleep}
      );
      stagedChunkCount++;
    }

    runId=await rpcWithTransientRetry(
      sb,
      "finalize_universe_screen_publish_v1_2",
      {p_publish_session_id:publishSessionId},
      {maxAttempts,sleep}
    );
  }

  if(!runId)throw new Error("Universe screen publication did not return a run id.");

  return{
    runId,
    publishSessionId,
    stagedChunkCount,
    alreadyPublished:Boolean(begin?.run_id),
  };
}
