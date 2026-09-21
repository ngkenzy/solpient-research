export function researchCutoff(run: {
  data_cutoff_at?: string | null;
  researched_at?: string | null;
}) {
  const raw=run?.data_cutoff_at??run?.researched_at??null;
  if(!raw)return {iso:null,date:null};
  const parsed=new Date(raw);
  if(!Number.isFinite(parsed.getTime()))return {iso:null,date:null};
  const iso=parsed.toISOString();
  return {iso,date:iso.slice(0,10)};
}

export async function getResearchTemporalContext(
  supabase:any,
  researchRunId:string,
) {
  const {data:run,error}=await supabase
    .from("research_runs")
    .select("id,company_id,version,data_cutoff_at,researched_at,source_context_pack_id")
    .eq("id",researchRunId)
    .maybeSingle();
  if(error)throw error;
  if(!run)return null;

  const cutoff=researchCutoff(run);
  let contextPack:any=null;
  let source:"frozen"|"legacy_as_of"|"unavailable"="unavailable";

  if(run.source_context_pack_id){
    const {data,error:packError}=await supabase
      .from("research_context_packs")
      .select("*")
      .eq("id",run.source_context_pack_id)
      .maybeSingle();
    if(packError)throw packError;
    if(data){
      contextPack=data;
      source="frozen";
    }
  }else if(cutoff.iso&&cutoff.date){
    const {data,error:packError}=await supabase
      .from("research_context_packs")
      .select("*")
      .eq("company_id",run.company_id)
      .lte("as_of_date",cutoff.date)
      .lte("generated_at",cutoff.iso)
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
      .limit(1)
      .maybeSingle();
    if(packError)throw packError;
    if(data){
      const knowledgeAt=data.knowledge_cutoff_at??data.generated_at;
      if(knowledgeAt&&new Date(knowledgeAt).getTime()<=new Date(cutoff.iso).getTime()){
        contextPack=data;
        source="legacy_as_of";
      }
    }
  }

  return {
    run,
    cutoff,
    contextPack,
    contextSource:source,
  };
}

export function isKnownBy(value:string|null|undefined,cutoffIso:string|null){
  if(!cutoffIso)return true;
  if(!value)return false;
  const known=new Date(value).getTime();
  const cutoff=new Date(cutoffIso).getTime();
  return Number.isFinite(known)&&Number.isFinite(cutoff)&&known<=cutoff;
}
