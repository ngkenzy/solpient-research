declare module "@/lib/portfolio-simulator.mjs" {
  export const PORTFOLIO_SIMULATOR_VERSION: string;
  export const DEFAULT_GUARDRAILS: Record<string,number>;

  export type PortfolioCandidate = {
    ticker: string;
    company_name?: string | null;
    group?: string | null;
    market_value?: number;
    readiness_state?: string;
    decision_score?: number | null;
    business_quality_score?: number | null;
    investment_opportunity_score?: number | null;
    evidence_confidence_score?: number | null;
    base_5y_cagr?: number | null;
    current_price?: number | null;
    bear_value?: number | null;
    base_value?: number | null;
    bull_value?: number | null;
  };

  export type PortfolioAnalysis = Record<string,any>;
  export type TradeSimulation = Record<string,any>;

  export function analyzePortfolio(input?: Record<string,any>,constraints?: Record<string,number>): PortfolioAnalysis;
  export function simulateTrades(input?: {
    portfolio?: Record<string,any>;
    candidates?: PortfolioCandidate[];
    trades?: Array<{ticker:string;amount:number}>;
    constraints?: Record<string,number>;
  }): TradeSimulation;
  export function buildTradeScenario(input?: Record<string,any>): TradeSimulation;
  export function compareScenarioImpacts(scenarios?: TradeSimulation[]): Array<Record<string,any>>;
}
