import { loadValuationBridgeData } from "@/lib/repositories/valuation-bridge";

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function money(value: unknown) {
  const parsed=n(value);
  return parsed==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(parsed);
}
function pct(value: unknown) {
  const parsed=n(value);
  return parsed==null?"—":parsed.toFixed(1)+"%";
}
function median(values:number[]) {
  if(!values.length)return null;
  const xs=[...values].sort((a,b)=>a-b);
  const m=Math.floor(xs.length/2);
  return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
}
function valuationGap(price:number|null,fair:number|null){
  if(price==null||fair==null||fair===0)return null;
  return (fair-price)/fair*100;
}

export async function ValuationBridge({
  companyId,
  researchRunId,
  ticker,
  currentPrice,
}:{
  companyId:string;
  researchRunId:string;
  ticker:string;
  currentPrice:number|null;
}) {
  const loaded=await loadValuationBridgeData(companyId,researchRunId);
  if(!loaded)return null;

  const valuation=loaded.valuation??{};
  const metrics=loaded.metrics??{};
  const analysis=(loaded.v2 as any)?.valuation_analysis??{};
  const persisted=analysis?.valuation_bridge??null;
  const cutoffIso=String(loaded.run?.data_cutoff_at??loaded.run?.researched_at??"");
  const cutoff=cutoffIso.slice(0,10);
  const peerRows=loaded.peers??[];
  const returns=loaded.returns??[];

  const formula=typeof persisted?.formula==="string"?persisted.formula:"median_of_applicable_anchors";
  const formulaExplanation=typeof persisted?.explanation==="string"
    ? persisted.explanation
    : "Reviewed base fair value is the median of the applicable normalized-multiple, DCF, and normalized peer-FCF anchors. Missing anchors are excluded rather than imputed.";
  let baseComponents:any=persisted?.components?.base??null;
  let auditStatus=persisted?.components?.base?"persisted":"legacy_reconstructed";
  let peerMedian:number|null=n(persisted?.peer_fcf_multiple);
  let fcfPerShare:number|null=n(persisted?.normalized_fcf_per_share);

  if(!baseComponents){
    if(fcfPerShare==null){
      const fcf=n((metrics as any).free_cash_flow);
      const shares=n((metrics as any).shares_outstanding);
      fcfPerShare=fcf!=null&&shares!=null&&shares!==0?fcf/shares:null;
    }
    const latestByPeer=new Map<string,number>();
    for(const row of peerRows){
      if(latestByPeer.has(row.peer_ticker))continue;
      const value=n(row.value_numeric);
      if(value!=null&&value>0)latestByPeer.set(row.peer_ticker,value);
    }
    peerMedian=median([...latestByPeer.values()]);
    const normalizedPeer=fcfPerShare!=null&&peerMedian!=null?fcfPerShare*peerMedian:null;
    baseComponents={
      normalized_multiple:n((valuation as any).earnings_multiple_value),
      dcf:n((valuation as any).dcf_value),
      normalized_peer_fcf:normalizedPeer,
      result:n((valuation as any).base_value),
    };
  }

  const componentRows=[
    {key:"dcf",label:"DCF",value:n(baseComponents?.dcf),detail:"5-year FCF DCF with explicit discount and terminal-growth assumptions"},
    {key:"normalized_multiple",label:"Normalized multiple",value:n(baseComponents?.normalized_multiple),detail:"Normalized per-share earnings/cash flow × defensible historical/peer multiple"},
    {key:"normalized_peer_fcf",label:"Peer FCF anchor",value:n(baseComponents?.normalized_peer_fcf),detail:peerMedian==null?"Peer P/FCF unavailable":peerMedian.toFixed(2)+"× median peer P/FCF × "+(fcfPerShare==null?"FCF/share":money(fcfPerShare)+" FCF/share")},
  ].filter(row=>row.value!=null);

  const recomputed=median(componentRows.map(row=>row.value as number));
  const reviewed=n((valuation as any).base_value);
  const bridgeDiff=recomputed!=null&&reviewed!=null?Math.abs(recomputed-reviewed):null;
  const verified=bridgeDiff!=null&&bridgeDiff<=0.25;
  if(auditStatus==="legacy_reconstructed"&&!verified) auditStatus="legacy_partial";

  const gap=valuationGap(currentPrice,reviewed);
  const base5=returns.find((row:any)=>row.scenario==="base"&&row.horizon_years===5);

  return (
    <section className="valuationBridgeSection">
      <div className="valuationBridgeHeader">
        <div>
          <span className="panelKicker">VALUATION BRIDGE</span>
          <h2>How fair value is formed</h2>
          <p>Transparent model anchors, aggregation formula, margin of safety, and expected-return test.</p>
        </div>
        <div className={"bridgeAuditBadge "+(auditStatus==="persisted"||verified?"verified":"partial")}>
          <span>{auditStatus==="persisted"?"Formula persisted":verified?"Legacy formula verified":"Formula partially auditable"}</span>
          <strong>{componentRows.length} anchors</strong>
        </div>
      </div>

      <div className="bridgeFormula">
        <span>BASE FAIR VALUE FORMULA</span>
        <strong>{formula.replaceAll("_"," ")}</strong>
        <p>{formulaExplanation}</p>
      </div>

      <div className="bridgeSteps">
        {componentRows.map((row,index)=>(
          <div className="bridgeStep" key={row.key}>
            <div className="bridgeStepNumber">{index+1}</div>
            <div>
              <span>{row.label}</span>
              <strong>{money(row.value)}</strong>
              <small>{row.detail}</small>
            </div>
          </div>
        ))}
        <div className="bridgeStep bridgeResult">
          <div className="bridgeStepNumber">=</div>
          <div>
            <span>Reviewed base fair value</span>
            <strong>{money(reviewed)}</strong>
            <small>{recomputed==null?"Component reconstruction unavailable":"Formula check "+money(recomputed)+(bridgeDiff!=null?" · difference "+money(bridgeDiff):"")}</small>
          </div>
        </div>
      </div>

      <div className="bridgeDecisionGrid">
        <div><span>Current price</span><strong>{money(currentPrice)}</strong></div>
        <div><span>Discount to fair value</span><strong>{gap==null?"—":(gap>=0?"+":"")+pct(gap)}</strong></div>
        <div><span>25% MOS price</span><strong>{money((valuation as any).mos_25_price)}</strong></div>
        <div><span>35% MOS price</span><strong>{money((valuation as any).mos_35_price)}</strong></div>
        <div><span>Bear value</span><strong>{money((valuation as any).bear_value)}</strong></div>
        <div><span>Bull value</span><strong>{money((valuation as any).bull_value)}</strong></div>
        <div><span>5Y base CAGR</span><strong>{pct((base5 as any)?.expected_cagr)}</strong></div>
        <div><span>Model</span><strong>{ticker} · v2</strong></div>
      </div>

      {auditStatus!=="persisted"?(
        <p className="bridgeLegacyNote">
          This published run predates persisted bridge metadata. Solpient reconstructed the applicable base anchors from the research-date database; future research versions store the formula and component values directly.
        </p>
      ):null}
    </section>
  );
}
