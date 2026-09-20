export const CAPITAL_ORCHESTRATOR_VERSION: string;
export const PROVIDER_PRIORITY: Record<string, number>;

export type NormalizedCapitalRecord = {
  company_id: string | null;
  activity_type: "insider" | "institutional" | "political" | null;
  actor_name: string | null;
  actor_detail: string | null;
  action: string | null;
  shares: number | null;
  price: number | null;
  value: number | null;
  change_pct: number | null;
  amount_range: string | null;
  transaction_date: string | null;
  disclosure_date: string | null;
  position_date: string | null;
  source_url: string | null;
  provider: string | null;
  source_key: string | null;
  verified_at: string | null;
  raw_payload: Record<string, unknown>;
};

export function normalizeCapitalRecord(
  input: any,
  options?: { provider?: string; verifiedAt?: string; companyByTicker?: Map<string, any> },
): { valid: boolean; errors: string[]; ticker: string | null; row: NormalizedCapitalRecord };

export function dedupeCapitalRecords<T = any>(records?: T[]): T[];
export function materialityForCapitalActivity(row: any): "info" | "review" | "high";
export function providerHealthRow(options?: any): any;
export function summarizeCapitalCoverage(rows?: any[], companies?: any[]): Array<{
  ticker: string;
  insider: number;
  institutional: number;
  political: number;
  last_verified_at: string | null;
  categories_covered: number;
}>;
export function feedFreshness(options?: {
  lastSuccessAt?: string | null;
  now?: Date;
  staleAfterHours?: number;
}): "inactive" | "stale" | "healthy";
