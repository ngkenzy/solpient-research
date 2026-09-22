const normalizeTicker=(ticker)=>String(ticker??"").trim().toUpperCase();

function securityPreference(row){
  const ticker=normalizeTicker(row?.ticker);
  let penalty=0;
  if(!ticker)penalty+=10000;
  if(/-P[A-Z0-9]*$/.test(ticker))penalty+=500;
  if(/[-./]/.test(ticker))penalty+=80;
  if(ticker.length>5)penalty+=40;
  if(ticker.length===5&&/[WUR]$/.test(ticker))penalty+=35;
  penalty+=ticker.length;
  return penalty;
}

export function canonicalizeIssuerMappings(rows=[]){
  const grouped=new Map();
  for(const raw of rows){
    const ticker=normalizeTicker(raw?.ticker);
    const cik=String(raw?.cik??"").replace(/\D/g,"");
    if(!ticker||!cik)continue;
    const row={...raw,ticker,cik};
    const list=grouped.get(cik)??[];
    list.push(row);
    grouped.set(cik,list);
  }

  const selected=[];
  const aliases={};
  for(const [cik,list] of grouped){
    list.sort((a,b)=>{
      const pref=securityPreference(a)-securityPreference(b);
      return pref||a.ticker.localeCompare(b.ticker);
    });
    const primary=list[0];
    selected.push(primary);
    aliases[cik]=list.map(x=>x.ticker);
  }
  selected.sort((a,b)=>a.ticker.localeCompare(b.ticker));
  return{
    selected,
    aliases,
    issuerCount:selected.length,
    removedSecurityMappings:Math.max(0,rows.length-selected.length),
  };
}
