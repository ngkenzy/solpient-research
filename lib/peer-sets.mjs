export const PEER_SETS = {
  ADBE: [
    { ticker:"CRM", relationship_type:"tracked", rationale:"Large-scale enterprise application software with recurring subscription economics." },
    { ticker:"MSFT", relationship_type:"tracked", rationale:"Platform software peer with cloud, productivity and AI monetization exposure." },
    { ticker:"ADSK", relationship_type:"reference", rationale:"Public design-software peer with subscription economics and creative/professional workflows." },
  ],
  DECK: [
    { ticker:"NKE", relationship_type:"reference", rationale:"Global footwear and apparel brand benchmark." },
    { ticker:"LULU", relationship_type:"reference", rationale:"Premium consumer-brand peer with direct-to-consumer exposure." },
    { ticker:"CROX", relationship_type:"reference", rationale:"Footwear peer with brand concentration and wholesale/DTC economics." },
  ],
  FDS: [
    { ticker:"MSCI", relationship_type:"reference", rationale:"Financial-data and subscription analytics peer." },
    { ticker:"SPGI", relationship_type:"reference", rationale:"Financial-data, indices and analytics peer." },
    { ticker:"MORN", relationship_type:"reference", rationale:"Investment-data and research subscription peer." },
  ],
  GMED: [
    { ticker:"SYK", relationship_type:"reference", rationale:"Orthopedic and medtech peer with procedure-volume exposure." },
    { ticker:"MDT", relationship_type:"reference", rationale:"Large diversified medtech benchmark." },
    { ticker:"ZBH", relationship_type:"reference", rationale:"Musculoskeletal and orthopedic peer." },
  ],
  CRM: [
    { ticker:"MSFT", relationship_type:"tracked", rationale:"Enterprise software and cloud platform peer." },
    { ticker:"ADBE", relationship_type:"tracked", rationale:"Subscription software peer with enterprise and digital workflow exposure." },
    { ticker:"ORCL", relationship_type:"reference", rationale:"Enterprise applications, database and cloud peer." },
    { ticker:"NOW", relationship_type:"reference", rationale:"Enterprise workflow software peer." },
  ],
  MCK: [
    { ticker:"CAH", relationship_type:"reference", rationale:"Healthcare distribution peer." },
    { ticker:"COR", relationship_type:"reference", rationale:"Pharmaceutical distribution peer." },
    { ticker:"CI", relationship_type:"reference", rationale:"Healthcare-services reference with pharmacy-services exposure." },
  ],
  BLBD: [
    { ticker:"ALSN", relationship_type:"tracked", rationale:"Commercial-vehicle drivetrain peer exposed to fleet and bus demand." },
    { ticker:"PCAR", relationship_type:"reference", rationale:"Commercial-vehicle manufacturing benchmark." },
    { ticker:"LEA", relationship_type:"reference", rationale:"Vehicle-systems supplier benchmark." },
  ],
  GOOGL: [
    { ticker:"META", relationship_type:"tracked", rationale:"Digital advertising platform and AI infrastructure peer." },
    { ticker:"MSFT", relationship_type:"tracked", rationale:"Cloud, AI and productivity platform competitor." },
    { ticker:"AMZN", relationship_type:"reference", rationale:"Cloud and digital-advertising platform benchmark." },
  ],
  META: [
    { ticker:"GOOGL", relationship_type:"tracked", rationale:"Digital advertising platform and AI infrastructure peer." },
    { ticker:"SNAP", relationship_type:"reference", rationale:"Social advertising platform benchmark." },
    { ticker:"PINS", relationship_type:"reference", rationale:"Social/discovery advertising platform benchmark." },
  ],
  MSFT: [
    { ticker:"CRM", relationship_type:"tracked", rationale:"Enterprise applications and subscription software peer." },
    { ticker:"ADBE", relationship_type:"tracked", rationale:"High-margin software and AI monetization peer." },
    { ticker:"GOOGL", relationship_type:"tracked", rationale:"Cloud and AI platform peer." },
    { ticker:"ORCL", relationship_type:"reference", rationale:"Enterprise software and cloud infrastructure peer." },
  ],
  MA: [
    { ticker:"V", relationship_type:"reference", rationale:"Closest global card-network peer." },
    { ticker:"AXP", relationship_type:"reference", rationale:"Payments peer with differentiated closed-loop economics." },
    { ticker:"FI", relationship_type:"reference", rationale:"Payments-processing and merchant-acquiring benchmark." },
  ],
  ICE: [
    { ticker:"CME", relationship_type:"reference", rationale:"Exchange and derivatives-market peer." },
    { ticker:"NDAQ", relationship_type:"reference", rationale:"Exchange, market-technology and data peer." },
    { ticker:"CBOE", relationship_type:"reference", rationale:"Exchange and market-data peer." },
  ],
  JPM: [
    { ticker:"BAC", relationship_type:"reference", rationale:"Large diversified U.S. bank peer." },
    { ticker:"WFC", relationship_type:"reference", rationale:"Large U.S. deposit and lending bank peer." },
    { ticker:"C", relationship_type:"reference", rationale:"Global diversified bank peer." },
    { ticker:"GS", relationship_type:"reference", rationale:"Capital-markets and investment-banking benchmark." },
  ],
  BSY: [
    { ticker:"ADSK", relationship_type:"reference", rationale:"Engineering/design software subscription peer." },
    { ticker:"PTC", relationship_type:"reference", rationale:"Industrial software and engineering workflow peer." },
    { ticker:"TRMB", relationship_type:"reference", rationale:"Infrastructure and engineering technology peer." },
  ],
  DCI: [
    { ticker:"PH", relationship_type:"reference", rationale:"Diversified industrial components and filtration benchmark." },
    { ticker:"ITW", relationship_type:"reference", rationale:"High-return diversified industrial peer." },
    { ticker:"FLS", relationship_type:"reference", rationale:"Flow-control industrial peer." },
  ],
  AOS: [
    { ticker:"WTS", relationship_type:"reference", rationale:"Water infrastructure and building-products peer." },
    { ticker:"XYL", relationship_type:"reference", rationale:"Water technology benchmark." },
    { ticker:"GGG", relationship_type:"reference", rationale:"Industrial equipment and fluid-handling benchmark." },
  ],
  DPZ: [
    { ticker:"YUM", relationship_type:"reference", rationale:"Global franchised restaurant peer." },
    { ticker:"MCD", relationship_type:"reference", rationale:"Large franchised restaurant benchmark." },
    { ticker:"PZZA", relationship_type:"reference", rationale:"Closest public pizza-chain peer." },
  ],
  ALSN: [
    { ticker:"BLBD", relationship_type:"tracked", rationale:"Commercial-vehicle demand peer with school-bus exposure." },
    { ticker:"PCAR", relationship_type:"reference", rationale:"Commercial-vehicle OEM benchmark." },
    { ticker:"CMI", relationship_type:"reference", rationale:"Powertrain and commercial-vehicle systems peer." },
  ],
  POWL: [
    { ticker:"ETN", relationship_type:"reference", rationale:"Electrical equipment and power-management peer." },
    { ticker:"HUBB", relationship_type:"reference", rationale:"Electrical products and grid-infrastructure peer." },
    { ticker:"GEV", relationship_type:"reference", rationale:"Power and grid equipment benchmark." },
  ],
  TILE: [
    { ticker:"MHK", relationship_type:"reference", rationale:"Flooring and building-products peer." },
    { ticker:"AWI", relationship_type:"reference", rationale:"Commercial interior building-products peer." },
    { ticker:"FBIN", relationship_type:"reference", rationale:"Building-products and remodeling exposure benchmark." },
  ],
  GIC: [
    { ticker:"FAST", relationship_type:"reference", rationale:"Industrial distribution peer." },
    { ticker:"GWW", relationship_type:"reference", rationale:"MRO and industrial distribution benchmark." },
    { ticker:"WCC", relationship_type:"reference", rationale:"Electrical and communications distribution peer." },
  ],
  ESQ: [
    { ticker:"WAL", relationship_type:"reference", rationale:"Specialty/commercial banking peer." },
    { ticker:"BANC", relationship_type:"reference", rationale:"Commercial bank benchmark." },
    { ticker:"FHB", relationship_type:"reference", rationale:"Regional bank benchmark with differentiated deposit base." },
  ],
};

export const TRACKED_TICKERS = Object.freeze([
  "ADBE","DECK","FDS","GMED","CRM","MCK","BLBD","GOOGL","META","MSFT","MA",
  "ICE","JPM","BSY","DCI","AOS","DPZ","ALSN","POWL","TILE","GIC","ESQ"
]);

export function peerSetForTicker(ticker) {
  return PEER_SETS[String(ticker).toUpperCase()] ?? [];
}
