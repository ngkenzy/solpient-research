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
  roic: number;
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

const historicalFinancials: Record<string, HistoricalFinancialSeries> = {
  ADBE: adbe,
};

export function getHistoricalFinancials(ticker: string) {
  return historicalFinancials[ticker.toUpperCase()] ?? null;
}
