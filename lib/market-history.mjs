export function marketNumber(value){
  if(value===null||value===undefined||(typeof value==="string"&&value.trim()===""))return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}

export function positiveMarketPrice(value){
  const parsed=marketNumber(value);
  return parsed!=null&&parsed>0?parsed:null;
}
