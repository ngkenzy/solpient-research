"use client";

import { useMemo, useState } from "react";

type MarketPoint = { date: string; price: number };
type AnnualPoint = {
  year: number;
  revenue: number | null;
  freeCashFlow: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  fcfMargin: number | null;
  eps: number | null;
  fcfPerShare: number | null;
  shares: number | null;
};
type ValuationPoint = {
  date: string;
  priceToFcf: number | null;
  fcfYield: number | null;
  pe: number | null;
  forwardPe: number | null;
};
type CapitalPoint = {
  year: number;
  dividends: number | null;
  buybacks: number | null;
  sbc: number | null;
  acquisitions: number | null;
  debtIssued: number | null;
  debtRepaid: number | null;
  shares: number | null;
};

function compact(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function moneyCompact(value: number | null | undefined) {
  if (value == null) return "—";
  return "$" + compact(value);
}

function pct(value: number | null | undefined) {
  return value == null ? "—" : value.toFixed(1) + "%";
}

function normalize(points: MarketPoint[]) {
  const first = points[0]?.price;
  if (!first) return [];
  return points.map((point) => ({ date: point.date, value: (point.price / first) * 100 }));
}

function rangeYears(date: string, years: number) {
  const end = new Date(date + "T00:00:00Z");
  end.setUTCFullYear(end.getUTCFullYear() - years);
  return end.toISOString().slice(0, 10);
}

function path(points: Array<{ x: number; y: number }>) {
  return points.map((point, i) => `${i ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function LineChart({
  series,
  formatter = (value: number) => value.toFixed(1),
  minOverride,
  maxOverride,
}: {
  series: Array<{ label: string; values: Array<{ label: string; value: number }> }>;
  formatter?: (value: number) => string;
  minOverride?: number;
  maxOverride?: number;
}) {
  const all = series.flatMap((item) => item.values.map((point) => point.value));
  if (!all.length) return <div className="performanceEmpty">No chart data available.</div>;
  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const pad = Math.max((rawMax - rawMin) * 0.12, rawMax === rawMin ? 1 : 0);
  const min = minOverride ?? rawMin - pad;
  const max = maxOverride ?? rawMax + pad;
  const spread = max - min || 1;
  const maxLen = Math.max(...series.map((item) => item.values.length));

  return (
    <div className="performanceLineWrap">
      <div className="performanceYAxis">
        <span>{formatter(max)}</span>
        <span>{formatter((max + min) / 2)}</span>
        <span>{formatter(min)}</span>
      </div>
      <div className="performanceSvg">
        <svg viewBox="0 0 100 48" role="img">
          <path className="performanceGrid" d="M 2 4 L 98 4 M 2 24 L 98 24 M 2 44 L 98 44" />
          {series.map((item, seriesIndex) => {
            const coords = item.values.map((point, index) => ({
              x: 3 + (index / Math.max(item.values.length - 1, 1)) * 94,
              y: 44 - ((point.value - min) / spread) * 40,
            }));
            return (
              <path
                key={item.label}
                className={`performanceLine performanceLine${seriesIndex + 1}`}
                d={path(coords)}
              />
            );
          })}
        </svg>
        <div className="performanceLegend">
          {series.map((item, index) => (
            <span key={item.label}><i className={`performanceLegendSwatch swatch${index + 1}`} />{item.label}</span>
          ))}
        </div>
        <div className="performanceXAxis">
          <span>{series[0]?.values[0]?.label ?? ""}</span>
          <span>{series[0]?.values[Math.floor((series[0]?.values.length ?? 1) / 2)]?.label ?? ""}</span>
          <span>{series[0]?.values.at(-1)?.label ?? ""}</span>
        </div>
      </div>
    </div>
  );
}

function BarChart({
  rows,
  keys,
}: {
  rows: Array<Record<string, any>>;
  keys: Array<{ key: string; label: string }>;
}) {
  const values = rows.flatMap((row) => keys.map((item) => Math.max(0, Number(row[item.key] ?? 0))));
  const max = Math.max(...values, 1);
  return (
    <>
      <div className="performanceBars">
        {rows.map((row) => (
          <div className="performanceBarGroup" key={row.year}>
            <div className="performanceBarColumns">
              {keys.map((item, index) => {
                const value = Math.max(0, Number(row[item.key] ?? 0));
                return (
                  <div className="performanceBarColumn" key={item.key}>
                    <i
                      className={`performanceBar performanceBar${index + 1}`}
                      style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
                      title={`${item.label}: ${moneyCompact(value)}`}
                    />
                  </div>
                );
              })}
            </div>
            <span>{row.year}</span>
          </div>
        ))}
      </div>
      <div className="performanceLegend">
        {keys.map((item, index) => (
          <span key={item.key}><i className={`performanceLegendSwatch swatch${index + 1}`} />{item.label}</span>
        ))}
      </div>
    </>
  );
}

function marketStats(points: MarketPoint[]) {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const totalReturn = (last.price / first.price - 1) * 100;
  const years = Math.max(
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / (365.25 * 24 * 3600 * 1000),
    0.01,
  );
  const cagr = ((last.price / first.price) ** (1 / years) - 1) * 100;
  let peak = points[0].price;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.price);
    maxDrawdown = Math.min(maxDrawdown, (point.price / peak - 1) * 100);
  }
  return { totalReturn, cagr, maxDrawdown };
}

export function CompanyPerformanceCharts({
  ticker,
  benchmarkTicker,
  market,
  benchmark,
  annual,
  valuation,
  capital,
}: {
  ticker: string;
  benchmarkTicker: string;
  market: MarketPoint[];
  benchmark: MarketPoint[];
  annual: AnnualPoint[];
  valuation: ValuationPoint[];
  capital: CapitalPoint[];
}) {
  const [years, setYears] = useState(5);
  const latestDate = market.at(-1)?.date ?? "";
  const cutoff = latestDate ? rangeYears(latestDate, years) : "";

  const marketWindow = useMemo(
    () => market.filter((point) => !cutoff || point.date >= cutoff),
    [market, cutoff],
  );
  const benchmarkWindow = useMemo(
    () => benchmark.filter((point) => !cutoff || point.date >= cutoff),
    [benchmark, cutoff],
  );
  const stockNormalized = normalize(marketWindow);
  const benchmarkNormalized = normalize(benchmarkWindow);
  const stockStats = marketStats(marketWindow);
  const benchmarkStats = marketStats(benchmarkWindow);

  const priceSeries = [
    { label: ticker, values: stockNormalized.map((point) => ({ label: point.date.slice(0, 7), value: point.value })) },
    ...(benchmarkNormalized.length > 1
      ? [{ label: benchmarkTicker, values: benchmarkNormalized.map((point) => ({ label: point.date.slice(0, 7), value: point.value })) }]
      : []),
  ];

  const marginSeries = [
    {
      label: "Gross margin",
      values: annual.filter((p) => p.grossMargin != null).map((p) => ({ label: String(p.year), value: p.grossMargin! })),
    },
    {
      label: "Operating margin",
      values: annual.filter((p) => p.operatingMargin != null).map((p) => ({ label: String(p.year), value: p.operatingMargin! })),
    },
    {
      label: "FCF margin",
      values: annual.filter((p) => p.fcfMargin != null).map((p) => ({ label: String(p.year), value: p.fcfMargin! })),
    },
  ].filter((item) => item.values.length);

  const perShareSeries = [
    {
      label: "Diluted EPS",
      values: annual.filter((p) => p.eps != null).map((p) => ({ label: String(p.year), value: p.eps! })),
    },
    {
      label: "FCF / share",
      values: annual.filter((p) => p.fcfPerShare != null).map((p) => ({ label: String(p.year), value: p.fcfPerShare! })),
    },
  ].filter((item) => item.values.length);

  const pFcf = valuation
    .filter((p) => p.priceToFcf != null && p.priceToFcf! > 0 && p.priceToFcf! < 150)
    .map((p) => ({ label: p.date.slice(0, 7), value: p.priceToFcf! }));
  const fcfYield = valuation
    .filter((p) => p.fcfYield != null && p.fcfYield! > -50 && p.fcfYield! < 50)
    .map((p) => ({ label: p.date.slice(0, 7), value: p.fcfYield! }));
  const currentPFcf = pFcf.at(-1)?.value ?? null;
  const medianPFcf = pFcf.length
    ? [...pFcf.map((p) => p.value)].sort((a, b) => a - b)[Math.floor(pFcf.length / 2)]
    : null;

  return (
    <div className="performanceGrid">
      <article className="performancePanel performanceWide">
        <div className="performancePanelHeader">
          <div>
            <span className="panelKicker">MARKET PERFORMANCE</span>
            <h3>{ticker} vs. {benchmarkTicker}</h3>
          </div>
          <div className="performanceRanges">
            {[1, 3, 5, 10].map((range) => (
              <button
                type="button"
                className={years === range ? "active" : ""}
                key={range}
                onClick={() => setYears(range)}
              >
                {range}Y
              </button>
            ))}
          </div>
        </div>
        <div className="performanceStats">
          <div><span>{ticker} return</span><strong>{pct(stockStats?.totalReturn)}</strong></div>
          <div><span>{ticker} CAGR</span><strong>{pct(stockStats?.cagr)}</strong></div>
          <div><span>Max drawdown</span><strong>{pct(stockStats?.maxDrawdown)}</strong></div>
          <div><span>{benchmarkTicker} return</span><strong>{pct(benchmarkStats?.totalReturn)}</strong></div>
        </div>
        <LineChart series={priceSeries} formatter={(value) => value.toFixed(0)} />
        {benchmarkNormalized.length < 2 ? (
          <p className="performanceFootnote">Benchmark history is still being backfilled; stock history is complete.</p>
        ) : (
          <p className="performanceFootnote">Indexed to 100 at the beginning of the selected period. Price return only; dividends are not reinvested.</p>
        )}
      </article>

      <article className="performancePanel performanceWide">
        <div className="performancePanelHeader">
          <div><span className="panelKicker">BUSINESS PERFORMANCE</span><h3>Revenue and free cash flow</h3></div>
          <small>Annual · USD</small>
        </div>
        <BarChart
          rows={annual as any}
          keys={[
            { key: "revenue", label: "Revenue" },
            { key: "freeCashFlow", label: "Free cash flow" },
          ]}
        />
      </article>

      <article className="performancePanel">
        <div className="performancePanelHeader">
          <div><span className="panelKicker">OPERATING ECONOMICS</span><h3>Margin history</h3></div>
          <small>Percent</small>
        </div>
        <LineChart series={marginSeries} formatter={(value) => value.toFixed(0) + "%"} minOverride={0} />
      </article>

      <article className="performancePanel">
        <div className="performancePanelHeader">
          <div><span className="panelKicker">PER-SHARE ECONOMICS</span><h3>EPS and FCF / share</h3></div>
          <small>USD / share</small>
        </div>
        <LineChart series={perShareSeries} formatter={(value) => "$" + value.toFixed(1)} />
      </article>

      <article className="performancePanel">
        <div className="performancePanelHeader">
          <div><span className="panelKicker">VALUATION HISTORY</span><h3>Price / free cash flow</h3></div>
          <small>{pFcf.length} monthly observations</small>
        </div>
        <div className="performanceStats compactStats">
          <div><span>Current</span><strong>{currentPFcf == null ? "—" : currentPFcf.toFixed(1) + "×"}</strong></div>
          <div><span>Median</span><strong>{medianPFcf == null ? "—" : medianPFcf.toFixed(1) + "×"}</strong></div>
        </div>
        <LineChart series={[{ label: "P/FCF", values: pFcf }]} formatter={(value) => value.toFixed(0) + "×"} minOverride={0} />
      </article>

      <article className="performancePanel">
        <div className="performancePanelHeader">
          <div><span className="panelKicker">CASH VALUATION</span><h3>Free-cash-flow yield</h3></div>
          <small>Percent</small>
        </div>
        <LineChart series={[{ label: "FCF yield", values: fcfYield }]} formatter={(value) => value.toFixed(1) + "%"} />
      </article>

      {capital.length ? (
        <article className="performancePanel performanceWide">
          <div className="performancePanelHeader">
            <div><span className="panelKicker">CAPITAL ALLOCATION</span><h3>Where owner cash went</h3></div>
            <small>Annual · USD</small>
          </div>
          <BarChart
            rows={capital as any}
            keys={[
              { key: "dividends", label: "Dividends" },
              { key: "buybacks", label: "Buybacks" },
              { key: "acquisitions", label: "Acquisitions" },
              { key: "debtRepaid", label: "Debt repaid" },
            ]}
          />
          <p className="performanceFootnote">Bars use reported or normalized stored capital-allocation history; zero or unavailable values remain visible as such.</p>
        </article>
      ) : null}
    </div>
  );
}
