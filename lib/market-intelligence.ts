export type SmartMoneyHolding = {
  manager: string;
  investor?: string;
  shares: number;
  value: number;
  changePct?: number | null;
  reportDate: string;
  sourceUrl: string;
};

export type CongressTrade = {
  politician: string;
  chamber: string;
  partyState?: string;
  action: "Purchase" | "Sale";
  amountRange: string;
  tradeDate: string;
  filingDate: string;
  sourceUrl: string;
};

export type InsiderTrade = {
  insider: string;
  title?: string;
  action: "Buy" | "Sell";
  shares: number;
  price: number;
  value: number;
  tradeDate: string;
  sourceUrl: string;
};

export type CompanyIntelligence = {
  ticker: string;
  updatedAt: string;
  smartMoney: SmartMoneyHolding[];
  congress: CongressTrade[];
  insiders: InsiderTrade[];
  notes: {
    smartMoney: string;
    congress: string;
    insiders: string;
  };
};

const deck: CompanyIntelligence = {
  ticker: "DECK",
  updatedAt: "2026-09-20T05:45:00Z",
  smartMoney: [
    {
      manager: "AQR Capital Management",
      investor: "Cliff Asness",
      shares: 2718623,
      value: 269932113,
      changePct: -31,
      reportDate: "2026-06-30",
      sourceUrl: "https://www.insidermonkey.com/insider-trading/company/deckers%2Boutdoor%2Bcorp/910521/",
    },
    {
      manager: "D. E. Shaw",
      investor: "D. E. Shaw",
      shares: 820888,
      value: 81505969,
      changePct: -36,
      reportDate: "2026-06-30",
      sourceUrl: "https://www.insidermonkey.com/insider-trading/company/deckers%2Boutdoor%2Bcorp/910521/",
    },
    {
      manager: "Greenlight Capital",
      investor: "David Einhorn",
      shares: 506398,
      value: 50280257,
      changePct: 6,
      reportDate: "2026-06-30",
      sourceUrl: "https://www.insidermonkey.com/insider-trading/company/deckers%2Boutdoor%2Bcorp/910521/",
    },
    {
      manager: "Citadel Advisors",
      investor: "Ken Griffin",
      shares: 496624,
      value: 49310000,
      changePct: null,
      reportDate: "2026-06-30",
      sourceUrl: "https://www.holdingschannel.com/institutional/holders-of-deckers-outdoor/",
    },
  ],
  congress: [
    {
      politician: "Ro Khanna",
      chamber: "House",
      partyState: "D-CA",
      action: "Purchase",
      amountRange: "$1,001–$15,000",
      tradeDate: "2026-08-03",
      filingDate: "2026-09-04",
      sourceUrl: "https://www.quiverquant.com/congresstrading/stock/DECK",
    },
    {
      politician: "Ro Khanna",
      chamber: "House",
      partyState: "D-CA",
      action: "Sale",
      amountRange: "$1,001–$15,000",
      tradeDate: "2026-06-30",
      filingDate: "2026-07-06",
      sourceUrl: "https://www.quiverquant.com/congresstrading/stock/DECK",
    },
    {
      politician: "Ro Khanna",
      chamber: "House",
      partyState: "D-CA",
      action: "Sale",
      amountRange: "$1,001–$15,000",
      tradeDate: "2026-05-15",
      filingDate: "2026-06-09",
      sourceUrl: "https://www.quiverquant.com/congresstrading/stock/DECK",
    },
    {
      politician: "Ro Khanna",
      chamber: "House",
      partyState: "D-CA",
      action: "Purchase",
      amountRange: "$1,001–$15,000",
      tradeDate: "2026-04-24",
      filingDate: "2026-05-11",
      sourceUrl: "https://www.quiverquant.com/congresstrading/stock/DECK",
    },
  ],
  insiders: [
    {
      insider: "Anne Spangenberg",
      title: "President, Fashion Lifestyle",
      action: "Sell",
      shares: 4063,
      price: 116.02,
      value: 471389.26,
      tradeDate: "2026-02-13",
      sourceUrl: "https://www.insidertrades.com/deckers-outdoor-co-stock/anne-spangenberg/",
    },
    {
      insider: "Lauri M. Shanahan",
      title: "Director",
      action: "Sell",
      shares: 4682,
      price: 114.84,
      value: 537680.88,
      tradeDate: "2026-02-13",
      sourceUrl: "https://www.insidertrades.com/deckers-outdoor-co-stock/",
    },
    {
      insider: "Robin Spring-Green",
      title: "President, HOKA",
      action: "Sell",
      shares: 347,
      price: 113.78,
      value: 39481.66,
      tradeDate: "2026-02-13",
      sourceUrl: "https://www.insidertrades.com/deckers-outdoor-co-stock/",
    },
  ],
  notes: {
    smartMoney: "13F positions are delayed disclosures. They show reported long U.S. equity positions as of the quarter end, not real-time holdings.",
    congress: "Congressional trades are disclosed after the transaction date. SOLPIENT shows both dates to avoid implying the trade happened on the filing date.",
    insiders: "Open-market insider purchases and sales are separated from routine grants and option exercises when the source supports that classification.",
  },
};

const intelligenceByTicker: Record<string, CompanyIntelligence> = {
  DECK: deck,
};

export function getCompanyIntelligence(ticker: string) {
  return intelligenceByTicker[ticker.toUpperCase()] ?? null;
}
