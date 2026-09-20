const ORDER={no_action:0,market_refresh:1,valuation_review:2,fundamentals_refresh:3,deep_research_refresh:4};
function d(v){return v?new Date(v):null;}function key(v){const x=d(v);return x?x.toISOString().slice(0,10):null;}function later(a,b){const x=d(a),y=d(b);return x&&y&&x>y;}
function businessDaysBetween(a,b){const from=d(a),to=d(b);if(!from||!to||from>=to)return 0;let n=0,x=new Date(from);x.setUTCHours(0,0,0,0);const end=new Date(to);end.setUTCHours(0,0,0,0);while(x<end){x.setUTCDate(x.getUTCDate()+1);const w=x.getUTCDay();if(w!==0&&w!==6)n++;}return n;}
export function planCompanyUpdate(input){const reasons=[];let action="no_action",priority=0;const escalate=(a,p,r)=>{reasons.push(r);if(ORDER[a]>ORDER[action]||(a===action&&p>priority)){action=a;priority=p;}};
 const reviewed=input.researchReviewedAt;if(!reviewed)escalate("deep_research_refresh",100,"No reviewed research baseline exists.");
 if(reviewed&&input.latestMaterialFilingDate&&later(input.latestMaterialFilingDate,reviewed))escalate("deep_research_refresh",95,"A material 10-K/10-Q/8-K filing is newer than the reviewed research.");
 if(reviewed&&input.latestFundamentalObservedAt&&later(input.latestFundamentalObservedAt,reviewed))escalate("fundamentals_refresh",80,"New normalized fundamental data is newer than the reviewed research.");
 const oldP=Number(input.priceAtResearch),newP=Number(input.latestPrice);if(Number.isFinite(oldP)&&oldP>0&&Number.isFinite(newP)&&newP>0){const move=Math.abs(newP/oldP-1);if(move>=.20)escalate("valuation_review",75,"Price moved "+(move*100).toFixed(1)+"% from the reviewed research price.");}
 const age=businessDaysBetween(input.latestMarketDate,input.asOfDate);if(!input.latestMarketDate||age>1)escalate("market_refresh",50,input.latestMarketDate?"Market snapshot is "+age+" business days stale.":"No market snapshot exists.");
 return{action,priority,reasons,marketAgeBusinessDays:age,asOfDate:key(input.asOfDate)};}
