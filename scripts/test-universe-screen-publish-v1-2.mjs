import assert from "node:assert/strict";
import {
  chunkResultRows,
  isTransientTransportError,
  rpcWithTransientRetry,
  publishUniverseScreenStaged,
} from "../lib/universe-screen-publish-v1-2.mjs";

const rows=Array.from({length:7},(_,i)=>({
  ticker:"T"+(i+1),
  result_hash:String(i+1).repeat(64).slice(0,64),
  payload:"x".repeat(40),
}));

const chunks=chunkResultRows(rows,{maxRows:3,maxBytes:10_000});
assert.equal(chunks.length,3);
assert.deepEqual(chunks.map(x=>x.startOrdinal),[1,4,7]);
assert.deepEqual(chunks.map(x=>x.rows.length),[3,3,1]);

assert.equal(isTransientTransportError({message:"Cloudflare 520"}),true);
assert.equal(isTransientTransportError({message:"HTTP 503"}),true);
assert.equal(isTransientTransportError({message:"permission denied"}),false);

let attempts=0;
const retrySb={
  async rpc(){
    attempts++;
    if(attempts<3)return{data:null,error:{message:"520 Cloudflare"}};
    return{data:{ok:true},error:null};
  },
};
const retried=await rpcWithTransientRetry(
  retrySb,"fixture_rpc",{},{
    maxAttempts:4,
    sleep:async()=>{},
  }
);
assert.deepEqual(retried,{ok:true});
assert.equal(attempts,3);

const calls=[];
let stageAttempt=0;
const fakeSb={
  async rpc(name,args){
    calls.push({name,args});
    if(name==="begin_universe_screen_publish_v1_2"){
      return{
        data:{
          status:"staging",
          publish_session_id:"00000000-0000-0000-0000-000000000001",
          run_id:null,
        },
        error:null,
      };
    }
    if(name==="stage_universe_screen_results_v1_2"){
      stageAttempt++;
      if(stageAttempt===1)return{data:null,error:{message:"520 Cloudflare"}};
      return{data:{ok:true},error:null};
    }
    if(name==="finalize_universe_screen_publish_v1_2"){
      return{data:"00000000-0000-0000-0000-000000000099",error:null};
    }
    throw new Error("Unexpected RPC "+name);
  },
};

const published=await publishUniverseScreenStaged({
  sb:fakeSb,
  runPayload:{input_hash:"a".repeat(64)},
  resultRows:rows,
  maxRows:3,
  maxBytes:10_000,
  maxAttempts:3,
  sleep:async()=>{},
});
assert.equal(published.runId,"00000000-0000-0000-0000-000000000099");
assert.equal(published.stagedChunkCount,3);
assert.equal(
  calls.filter(x=>x.name==="stage_universe_screen_results_v1_2").length,
  4,
  "one transient staging failure should retry exactly once"
);

const alreadySb={
  async rpc(name){
    assert.equal(name,"begin_universe_screen_publish_v1_2");
    return{
      data:{
        status:"already_published",
        publish_session_id:null,
        run_id:"00000000-0000-0000-0000-000000000077",
      },
      error:null,
    };
  },
};
const existing=await publishUniverseScreenStaged({
  sb:alreadySb,
  runPayload:{input_hash:"b".repeat(64)},
  resultRows:rows,
});
assert.equal(existing.alreadyPublished,true);
assert.equal(existing.stagedChunkCount,0);
assert.equal(existing.runId,"00000000-0000-0000-0000-000000000077");

assert.throws(
  ()=>chunkResultRows([{ticker:"BIG",payload:"x".repeat(5_000)}],{maxBytes:1_024}),
  /exceeds the staging payload ceiling/
);

console.log("Universe Screen Staged Publication V1.2 tests passed.");
