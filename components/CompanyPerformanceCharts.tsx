"use client";

import { useMemo, useState, type PointerEvent } from "react";

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
  period: string;
  periodEnd: string;
  year: number;
  dividends: number | null;
  buybacks: number | null;
  sbc: number | null;
  acquisitions: number | null;
  debtIssued: number | null;
  debtRepaid: number | null;
  shares: number | null;
};
export type PeerPoint = {
  ticker: string;
  revenueGrowth: number | null;
  fcfMargin: number | null;
  priceToFcf: number | null;
  fcfYield: number | null;
};

type SeriesPoint = { label: string; value: number };
type Series = { label: string; values: SeriesPoint[] };

function compact(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function moneyCompact(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
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

function svgPath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, i) => `${i ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function InteractiveLineChart({
  series,
  formatter = (value: number) => value.toFixed(1),
  minOverride,
  maxOverride,
}: {
  series: Series[];
  formatter?: (value: number) => string;
  minOverride?: number;
  maxOverride?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [lockedIndex, setLockedIndex] = useState<number | null>(null);
  const all = series.flatMap((item) => item.values.map((point) => point.value));
  if (!all.length) return <div className="performanceEmpty">No chart data available.</div>;

  const longest = series.reduce(
    (best, item) => (item.values.length > best.values.length ? item : best),
    series[0],
  );
  const pointCount = longest.values.length;
  const activeIndex = lockedIndex ?? hoverIndex ?? Math.max(0, pointCount - 1);
  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const pad = Math.max((rawMax - rawMin) * 0.12, rawMax === rawMin ? 1 : 0);
  const min = minOverride ?? rawMin - pad;
  const max = maxOverride ?? rawMax + pad;
  const spread = max - min || 1;

  function indexFromPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.round(ratio * Math.max(pointCount - 1, 0));
  }

  const activeLabel = longest.values[activeIndex]?.label ?? "";
  const activeValues = series.map((item) => {
    const exact = item.values.find((point) => point.label === activeLabel);
    const fallback = item.values[Math.min(activeIndex, item.values.length - 1)];
    return { label: item.label, point: exact ?? fallback };
  });

  return (
    <div className="interactiveChart">
      <div className="performanceLineWrap">
        <div className="performanceYAxis">
          <span>{formatter(max)}</span>
          <span>{formatter((max + min) / 2)}</span>
          <span>{formatter(min)}</span>
        </div>
        <div className="performanceSvg">
          <svg
            viewBox="0 0 100 48"
            role="img"
            onPointerMove={(event) => setHoverIndex(indexFromPointer(event))}
            onPointerLeave={() => setHoverIndex(null)}
            onClick={(event) => {
              const next = indexFromPointer(event);
              setLockedIndex((current) => (current === next ? null : next));
            }}
          >
            <path className="performanceChartGrid" d="M 2 4 L 98 4 M 2 24 L 98 24 M 2 44 L 98 44" />
            {series.map((item, seriesIndex) => {
              const coords = item.values.map((point, index) => ({
                x: 3 + (index / Math.max(item.values.length - 1, 1)) * 94,
                y: 44 - ((point.value - min) / spread) * 40,
              }));
              return (
                <g key={item.label}>
                  <path
                    className={`performanceLine performanceLine${seriesIndex + 1}`}
                    d={svgPath(coords)}
                  />
                  {coords.map((point, index) => (
                    <circle
                      key={index}
                      className={index === activeIndex ? `performancePoint point${seriesIndex + 1} active` : `performancePoint point${seriesIndex + 1}`}
                      cx={point.x}
                      cy={point.y}
                      r={index === activeIndex ? 1.2 : .55}
                    />
                  ))}
                </g>
              );
            })}
            {pointCount > 1 ? (
              <line
                className="performanceCrosshair"
                x1={3 + (activeIndex / Math.max(pointCount - 1, 1)) * 94}
                x2={3 + (activeIndex / Math.max(pointCount - 1, 1)) * 94}
                y1="3"
                y2="45"
              />
            ) : null}
          </svg>
          <div className="performanceXAxis">
            <span>{longest.values[0]?.label ?? ""}</span>
            <span>{longest.values[Math.floor(pointCount / 2)]?.label ?? ""}</span>
            <span>{longest.values.at(-1)?.label ?? ""}</span>
          </div>
        </div>
      </div>

      <div className="chartInspector" aria-live="polite">
        <div className="chartInspectorDate">
          <span>Selected</span>
          <strong>{activeLabel || "—"}</strong>
          <small>{lockedIndex == null ? "Hover or click chart" : "Click again to unlock"}</small>
        </div>
        {activeValues.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.point ? formatter(item.point.value) : "—"}</strong>
          </div>
        ))}
      </div>

      <div className="performanceLegend">
        {series.map((item, index) => (
          <span key={item.label}>
            <i className={`performanceLegendSwatch swatch${index + 1}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function InteractiveBarChart({
  rows,
  keys,
  labelKey = "year",
}: {
  rows: Array<Record<string, any>>;
  keys: Array<{ key: string; label: string }>;
  labelKey?: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, rows.length - 1));
  const activeKeys = keys.filter((item) =>
    rows.some((row) => Number.isFinite(Number(row[item.key])) && Number(row[item.key]) !== 0),
  );
  const values = rows.flatMap((row) =>
    activeKeys.map((item) => Math.max(0, Number(row[item.key] ?? 0))),
  );
  const max = Math.max(...values, 1);
  const selected = rows[selectedIndex] ?? rows.at(-1);

  if (!rows.length || !activeKeys.length) {
    return <div className="performanceEmpty">No monetary chart data available.</div>;
  }

  return (
    <div className="interactiveBarChart">
      <div
        className="performanceBars"
        style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }}
      >
        {rows.map((row, rowIndex) => (
          <button
            type="button"
            className={rowIndex === selectedIndex ? "performanceBarGroup active" : "performanceBarGroup"}
            key={String(row[labelKey]) + rowIndex}
            onMouseEnter={() => setSelectedIndex(rowIndex)}
            onFocus={() => setSelectedIndex(rowIndex)}
            onClick={() => setSelectedIndex(rowIndex)}
          >
            <div className="performanceBarColumns">
              {activeKeys.map((item, index) => {
                const value = Math.max(0, Number(row[item.key] ?? 0));
                return (
                  <div className="performanceBarColumn" key={item.key}>
                    <span className="performanceBarValue">
                      {value > 0 ? moneyCompact(value) : ""}
                    </span>
                    <i
                      className={`performanceBar performanceBar${index + 1}`}
                      style={{ height: `${value > 0 ? Math.max(3, (value / max) * 100) : 0}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <span>{String(row[labelKey] ?? "")}</span>
          </button>
        ))}
      </div>

      <div className="barInspector" aria-live="polite">
        <div>
          <span>Selected period</span>
          <strong>{String(selected?.[labelKey] ?? "—")}</strong>
        </div>
        {activeKeys.map((item) => (
          <div key={item.key}>
            <span>{item.label}</span>
            <strong>{moneyCompact(Number(selected?.[item.key] ?? 0))}</strong>
          </div>
        ))}
      </div>

      <div className="performanceLegend">
        {activeKeys.map((item, index) => (
          <span key={item.key}>
            <i className={`performanceLegendSwatch swatch${index + 1}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PeerComparisonChart({ ticker, peers }: { ticker: string; peers: PeerPoint[] }) {
  const metrics = [
    { key: "revenueGrowth", label: "Revenue growth", suffix: "%" },
    { key: "fcfMargin", label: "FCF margin", suffix: "%" },
    { key: "priceToFcf", label: "P / FCF", suffix: "×" },
    { key: "fcfYield", label: "FCF yield", suffix: "%" },
  ] as const;
  const [metricKey, setMetricKey] = useState<(typeof metrics)[number]["key"]>("fcfMargin");
  const [selectedTicker, setSelectedTicker] = useState(ticker);
  const metric = metrics.find((item) => item.key === metricKey)!;
  const valid = peers.filter((peer) => peer[metricKey] != null);
  const max = Math.max(...valid.map((peer) => Math.abs(Number(peer[metricKey]))), 1);
  const selected = peers.find((peer) => peer.ticker === selectedTicker) ?? valid[0];

  return (
    <article className="performancePanel performanceWide peerChartPanel">
      <div className="performancePanelHeader">
        <div>
          <span className="panelKicker">RELATIVE CONTEXT</span>
          <h3>Peer comparison</h3>
        </div>
        <div className="peerMetricSelector">
          {metrics.map((item) => (
            <button
              type="button"
              key={item.key}
              className={metricKey === item.key ? "active" : ""}
              onClick={() => setMetricKey(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {valid.length ? (
        <>
          <div className="peerBarChart">
            {valid.map((peer) => {
              const value = Number(peer[metricKey]);
              return (
                <button
                  type="button"
                  key={peer.ticker}
                  className={selected?.ticker === peer.ticker ? "peerBarRow active" : "peerBarRow"}
                  onMouseEnter={() => setSelectedTicker(peer.ticker)}
                  onFocus={() => setSelectedTicker(peer.ticker)}
                  onClick={() => setSelectedTicker(peer.ticker)}
                >
                  <strong>{peer.ticker}</strong>
                  <div><i style={{ width: `${Math.max(2, (Math.abs(value) / max) * 100)}%` }} /></div>
                  <span>{value.toFixed(1)}{metric.suffix}</span>
                </button>
              );
            })}
          </div>
          <div className="peerInspector">
            <strong>{selected?.ticker ?? "—"}</strong>
            <span>Revenue growth {pct(selected?.revenueGrowth)}</span>
            <span>FCF margin {pct(selected?.fcfMargin)}</span>
            <span>P/FCF {selected?.priceToFcf == null ? "—" : selected.priceToFcf.toFixed(1) + "×"}</span>
            <span>FCF yield {pct(selected?.fcfYield)}</span>
          </div>
        </>
      ) : (
        <div className="performanceEmpty">No peer data available for this metric.</div>
      )}
    </article>
  );
}

function marketStats(points: MarketPoint[]) {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const totalReturn = (last.price / first.price - 1) * 100;
  const years = Math.max(
    (new Date(last.date).getTime() - new Date(first.date).getTime()) /
      (365.25 * 24 * 3600 * 1000),
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
  peers,
}: {
  ticker: string;
  benchmarkTicker: string;
  market: MarketPoint[];
  benchmark: MarketPoint[];
  annual: AnnualPoint[];
  valuation: ValuationPoint[];
  capital: CapitalPoint[];
  peers: PeerPoint[];
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
    {
      label: ticker,
      values: stockNormalized.map((point) => ({
        label: point.date.slice(0, 7),
        value: point.value,
      })),
    },
    ...(benchmarkNormalized.length > 1
      ? [
          {
            label: benchmarkTicker,
            values: benchmarkNormalized.map((point) => ({
              label: point.date.slice(0, 7),
              value: point.value,
            })),
          },
        ]
      : []),
  ];

  const marginSeries = [
    {
      label: "Gross margin",
      values: annual
        .filter((p) => p.grossMargin != null)
        .map((p) => ({ label: String(p.year), value: p.grossMargin! })),
    },
    {
      label: "Operating margin",
      values: annual
        .filter((p) => p.operatingMargin != null)
        .map((p) => ({ label: String(p.year), value: p.operatingMargin! })),
    },
    {
      label: "FCF margin",
      values: annual
        .filter((p) => p.fcfMargin != null)
        .map((p) => ({ label: String(p.year), value: p.fcfMargin! })),
    },
  ].filter((item) => item.values.length);

  const perShareSeries = [
    {
      label: "Diluted EPS",
      values: annual
        .filter((p) => p.eps != null)
        .map((p) => ({ label: String(p.year), value: p.eps! })),
    },
    {
      label: "FCF / share",
      values: annual
        .filter((p) => p.fcfPerShare != null)
        .map((p) => ({ label: String(p.year), value: p.fcfPerShare! })),
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

  const capitalKeys = [
    { key: "dividends", label: "Dividends" },
    { key: "buybacks", label: "Buybacks" },
    { key: "sbc", label: "Stock comp." },
    { key: "acquisitions", label: "Acquisitions" },
    { key: "debtRepaid", label: "Debt repaid" },
    { key: "debtIssued", label: "Debt issued" },
  ];

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
        <InteractiveLineChart series={priceSeries} formatter={(value) => value.toFixed(0)} />
        <p className="performanceFootnote">
          Indexed to 100 at the beginning of the selected period. Hover to inspect; click a point to lock it. Price return only; dividends are not reinvested.
        </p>
      </article>

      <article className="performancePanel performanceWide">
        <div className="performancePanelHeader">
          <div>
            <span className="panelKicker">BUSINESS PERFORMANCE</span>
            <h3>Revenue and free cash flow</h3>
          </div>
          <small>Annual · USD</small>
        </div>
        <InteractiveBarChart
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
        <InteractiveLineChart
          series={marginSeries}
          formatter={(value) => value.toFixed(1) + "%"}
          minOverride={0}
        />
      </article>

      <article className="performancePanel">
        <div className="performancePanelHeader">
          <div><span className="panelKicker">PER-SHARE ECONOMICS</span><h3>EPS and FCF / share</h3></div>
          <small>USD / share</small>
        </div>
        <InteractiveLineChart
          series={perShareSeries}
          formatter={(value) => "$" + value.toFixed(2)}
        />
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
        <InteractiveLineChart
          series={[{ label: "P/FCF", values: pFcf }]}
          formatter={(value) => value.toFixed(1) + "×"}
          minOverride={0}
        />
      </article>

      <article className="performancePanel">
        <div className="performancePanelHeader">
          <div><span className="panelKicker">CASH VALUATION</span><h3>Free-cash-flow yield</h3></div>
          <small>Percent</small>
        </div>
        <InteractiveLineChart
          series={[{ label: "FCF yield", values: fcfYield }]}
          formatter={(value) => value.toFixed(1) + "%"}
        />
      </article>

      {capital.length ? (
        <article className="performancePanel performanceWide">
          <div className="performancePanelHeader">
            <div>
              <span className="panelKicker">CAPITAL ALLOCATION</span>
              <h3>Cash allocation and dilution cost by reported period</h3>
            </div>
            <small>USD · hover/click a period</small>
          </div>
          <InteractiveBarChart
            rows={capital as any}
            keys={capitalKeys}
            labelKey="period"
          />
          <p className="performanceFootnote">
            Periods remain quarterly when the source database contains quarterly observations; null categories are omitted rather than displayed as false zeros.
          </p>
        </article>
      ) : null}

      {peers.length ? <PeerComparisonChart ticker={ticker} peers={peers} /> : null}
    </div>
  );
}
