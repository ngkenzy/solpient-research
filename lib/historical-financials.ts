export type HistoricalFinancialPoint = {
  fiscalYear: number;
  revenue: number;
  grossProfit: number;
  operatingIncome: number;
  operatingCashFlow: number;
  capex: number;
  freeCashFlow: number;
  dilutedEps: number;
  dilutedShares: number;
  grossMargin: number;
  operatingMargin: number;
  fcfMargin: number;
  roic: number | null;
};

export type HistoricalFinancialSeries = {
  ticker: string;
  units: "USD millions";
  methodology: {
    freeCashFlow: string;
    roic: string;
  };
  points: HistoricalFinancialPoint[];
  sources: Array<{
    label: string;
    url: string;
  }>;
};

const adbe: HistoricalFinancialSeries = {
  ticker: "ADBE",
  units: "USD millions",
  methodology: {
    freeCashFlow: "Operating cash flow minus purchases of property and equipment.",
    roic: "SOLPIENT calculation: NOPAT divided by average invested capital, where NOPAT = operating income × (1 - effective tax rate) and invested capital = debt + equity - cash - short-term investments.",
  },
  points: [
    {
      fiscalYear: 2021,
      revenue: 15785,
      grossProfit: 13920,
      operatingIncome: 5802,
      operatingCashFlow: 7230,
      capex: 348,
      freeCashFlow: 6882,
      dilutedEps: 10.02,
      dilutedShares: 481.0,
      grossMargin: 88.18,
      operatingMargin: 36.76,
      fcfMargin: 43.60,
      roic: 40.01,
    },
    {
      fiscalYear: 2022,
      revenue: 17606,
      grossProfit: 15441,
      operatingIncome: 6098,
      operatingCashFlow: 7838,
      capex: 442,
      freeCashFlow: 7396,
      dilutedEps: 10.10,
      dilutedShares: 470.9,
      grossMargin: 87.70,
      operatingMargin: 34.64,
      fcfMargin: 42.01,
      roic: 38.30,
    },
    {
      fiscalYear: 2023,
      revenue: 19409,
      grossProfit: 17055,
      operatingIncome: 6650,
      operatingCashFlow: 7302,
      capex: 360,
      freeCashFlow: 6942,
      dilutedEps: 11.82,
      dilutedShares: 459.1,
      grossMargin: 87.87,
      operatingMargin: 34.26,
      fcfMargin: 35.77,
      roic: 43.53,
    },
    {
      fiscalYear: 2024,
      revenue: 21505,
      grossProfit: 19147,
      operatingIncome: 6741,
      operatingCashFlow: 8056,
      capex: 183,
      freeCashFlow: 7873,
      dilutedEps: 12.36,
      dilutedShares: 449.7,
      grossMargin: 89.04,
      operatingMargin: 31.35,
      fcfMargin: 36.61,
      roic: 44.77,
    },
    {
      fiscalYear: 2025,
      revenue: 23769,
      grossProfit: 21218,
      operatingIncome: 8706,
      operatingCashFlow: 10031,
      capex: 179,
      freeCashFlow: 9852,
      dilutedEps: 16.70,
      dilutedShares: 427.0,
      grossMargin: 89.27,
      operatingMargin: 36.63,
      fcfMargin: 41.45,
      roic: 61.57,
    },
  ],
  sources: [
    {
      label: "Adobe FY2025 Form 10-K",
      url: "https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm",
    },
    {
      label: "Adobe FY2023 Form 10-K",
      url: "https://www.sec.gov/Archives/edgar/data/796343/000079634324000006/adbe-20231201.htm",
    },
    {
      label: "Adobe FY2021 Form 10-K",
      url: "https://www.sec.gov/Archives/edgar/data/796343/000079634322000032/adbe-20211203.htm",
    },
  ],
};

const deck: HistoricalFinancialSeries = {
  ticker: "DECK",
  units: "USD millions",
  methodology: {
    freeCashFlow: "Operating cash flow minus purchases of property and equipment, consistent with Deckers' stated free-cash-flow definition.",
    roic: "ROIC is not charted for DECK until normalized invested-capital history is stored; excess cash and no outstanding borrowings make simplistic capital-return calculations misleading.",
  },
  points: [
    {
      fiscalYear: 2022,
      revenue: 3150.339,
      grossProfit: 1607.551,
      operatingIncome: 564.707,
      operatingCashFlow: 172.353,
      capex: 51.017,
      freeCashFlow: 121.336,
      dilutedEps: 2.71,
      dilutedShares: 166.734,
      grossMargin: 51.03,
      operatingMargin: 17.93,
      fcfMargin: 3.85,
      roic: null,
    },
    {
      fiscalYear: 2023,
      revenue: 3627.286,
      grossProfit: 1825.370,
      operatingIncome: 652.751,
      operatingCashFlow: 537.422,
      capex: 81.025,
      freeCashFlow: 456.397,
      dilutedEps: 3.23,
      dilutedShares: 160.116,
      grossMargin: 50.32,
      operatingMargin: 18.00,
      fcfMargin: 12.58,
      roic: null,
    },
    {
      fiscalYear: 2024,
      revenue: 4287.763,
      grossProfit: 2385.488,
      operatingIncome: 927.514,
      operatingCashFlow: 1033.184,
      capex: 89.365,
      freeCashFlow: 943.819,
      dilutedEps: 4.86,
      dilutedShares: 156.285,
      grossMargin: 55.63,
      operatingMargin: 21.63,
      fcfMargin: 22.01,
      roic: null,
    },
    {
      fiscalYear: 2025,
      revenue: 4985.612,
      grossProfit: 2885.663,
      operatingIncome: 1179.092,
      operatingCashFlow: 1044.523,
      capex: 86.171,
      freeCashFlow: 958.352,
      dilutedEps: 6.33,
      dilutedShares: 152.670,
      grossMargin: 57.88,
      operatingMargin: 23.65,
      fcfMargin: 19.22,
      roic: null,
    },
    {
      fiscalYear: 2026,
      revenue: 5472.296,
      grossProfit: 3157.726,
      operatingIncome: 1262.903,
      operatingCashFlow: 1181.955,
      capex: 84.623,
      freeCashFlow: 1097.332,
      dilutedEps: 7.02,
      dilutedShares: 145.805,
      grossMargin: 57.70,
      operatingMargin: 23.08,
      fcfMargin: 20.05,
      roic: null,
    },
  ],
  sources: [
    {
      label: "Deckers FY2026 Form 10-K",
      url: "https://www.sec.gov/Archives/edgar/data/910521/000162828026037664/deck-20260331.htm",
    },
    {
      label: "Deckers FY2024 Form 10-K",
      url: "https://www.sec.gov/Archives/edgar/data/910521/000091052124000017/deck-20240331.htm",
    },
    {
      label: "Deckers FY2022 Form 10-K",
      url: "https://www.sec.gov/Archives/edgar/data/910521/000091052122000017/deck-20220331.htm",
    },
  ],
};

const historicalFinancials: Record<string, HistoricalFinancialSeries> = {
  ADBE: adbe,
  DECK: deck,
};

export function getHistoricalFinancials(ticker: string) {
  return historicalFinancials[ticker.toUpperCase()] ?? null;
}
