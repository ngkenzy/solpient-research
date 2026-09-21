import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

const CAPITAL_KEYS = [
  "dividends_paid",
  "buybacks",
  "stock_based_compensation",
  "acquisitions",
  "debt_issued",
  "debt_repaid",
];

export async function GET(request: Request) {
  const ticker =
    new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase() || "PFE";
  const supabase = getSupabase();

  if (!supabase) {
    return NextResponse.json(
      { status: "error", ticker, error: "Supabase public client is not configured." },
      { status: 503 },
    );
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,ticker")
    .eq("ticker", ticker)
    .maybeSingle();

  if (companyError || !company) {
    return NextResponse.json(
      {
        status: "error",
        ticker,
        error: companyError?.message ?? "Company not found.",
      },
      { status: 404 },
    );
  }

  const [valuationCount, latestValuation, capitalResult, peerResult, runResult] =
    await Promise.all([
      supabase
        .from("valuation_history")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .not("price_to_fcf", "is", null)
        .not("fcf_yield", "is", null),
      supabase
        .from("valuation_history")
        .select("trading_date,price_to_fcf,fcf_yield")
        .eq("company_id", company.id)
        .not("price_to_fcf", "is", null)
        .not("fcf_yield", "is", null)
        .order("trading_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("company_metric_history")
        .select("fiscal_year,period_type,metric_key,value_numeric")
        .eq("company_id", company.id)
        .eq("period_type", "fiscal_year")
        .in("metric_key", CAPITAL_KEYS)
        .order("fiscal_year", { ascending: true }),
      supabase
        .from("peer_metric_snapshots")
        .select("peer_ticker,metric_key")
        .eq("company_id", company.id)
        .in("metric_key", [
          "revenue_growth_yoy",
          "fcf_margin",
          "price_to_fcf",
          "fcf_yield",
        ]),
      supabase
        .from("research_runs")
        .select("id,version,researched_at")
        .eq("company_id", company.id)
        .eq("status", "published")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const errors = [
    valuationCount.error,
    latestValuation.error,
    capitalResult.error,
    peerResult.error,
    runResult.error,
  ]
    .filter(Boolean)
    .map((error) => error!.message);

  const capitalByYear = new Map<number, Set<string>>();
  for (const row of capitalResult.data ?? []) {
    const year = Number(row.fiscal_year);
    if (!Number.isInteger(year)) continue;
    const keys = capitalByYear.get(year) ?? new Set<string>();
    keys.add(row.metric_key);
    capitalByYear.set(year, keys);
  }

  const completeCapitalYears = [...capitalByYear.entries()]
    .filter(([, keys]) => CAPITAL_KEYS.every((key) => keys.has(key)))
    .map(([year]) => year)
    .sort((a, b) => a - b);

  const peerTickers = [
    ...new Set((peerResult.data ?? []).map((row: any) => row.peer_ticker)),
  ].filter(Boolean);

  const checks = {
    valuationHistory: {
      pass: (valuationCount.count ?? 0) >= 24,
      observations: valuationCount.count ?? 0,
      latest: latestValuation.data ?? null,
    },
    capitalAllocation: {
      pass: completeCapitalYears.length >= 5,
      completeFiscalYears: completeCapitalYears,
      requiredMetrics: CAPITAL_KEYS,
    },
    peerComparison: {
      pass: peerTickers.length >= 4,
      peerCount: peerTickers.length,
      peers: peerTickers.sort(),
    },
    publishedResearch: {
      pass: Boolean(runResult.data),
      latestRun: runResult.data ?? null,
    },
  };

  const healthy = errors.length === 0 && Object.values(checks).every((check) => check.pass);

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      ticker,
      generatedAt: new Date().toISOString(),
      checks,
      errors,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
