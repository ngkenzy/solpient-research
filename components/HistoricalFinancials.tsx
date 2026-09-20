import { getHistoricalFinancials, type HistoricalFinancialPoint } from "@/lib/historical-financials";

function compact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value * 1_000_000);
}

function linePath(
  points: HistoricalFinancialPoint[],
  accessor: (point: HistoricalFinancialPoint) => number,
  minValue?: number,
  maxValue?: number
) {
  const values = points.map(accessor);
  const min = minValue ?? Math.min(...values);
  const max = maxValue ?? Math.max(...values);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = 8 + (index / Math.max(points.length - 1, 1)) * 84;
      const y = 88 - ((accessor(point) - min) / range) * 72;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function lineDots(
  points: HistoricalFinancialPoint[],
  accessor: (point: HistoricalFinancialPoint) => number,
  minValue?: number,
  maxValue?: number
) {
  const values = points.map(accessor);
  const min = minValue ?? Math.min(...values);
  const max = maxValue ?? Math.max(...values);
  const range = max - min || 1;

  return points.map((point, index) => ({
    x: 8 + (index / Math.max(points.length - 1, 1)) * 84,
    y: 88 - ((accessor(point) - min) / range) * 72,
    value: accessor(point),
    year: point.fiscalYear,
  }));
}

function ChartAxis({ points }: { points: HistoricalFinancialPoint[] }) {
  return (
    <div className="chartAxis">
      {points.map((point) => (
        <span key={point.fiscalYear}>{point.fiscalYear}</span>
      ))}
    </div>
  );
}

function BarChart({ points }: { points: HistoricalFinancialPoint[] }) {
  const max = Math.max(...points.flatMap((p) => [p.revenue, p.freeCashFlow]));

  return (
    <>
      <div className="barChart" aria-label="Revenue and free cash flow history">
        {points.map((point) => (
          <div className="barGroup" key={point.fiscalYear}>
            <div className="barPair">
              <i
                className="bar revenueBar"
                style={{ height: `${(point.revenue / max) * 100}%` }}
                title={`Revenue ${compact(point.revenue)}`}
              />
              <i
                className="bar fcfBar"
                style={{ height: `${(point.freeCashFlow / max) * 100}%` }}
                title={`FCF ${compact(point.freeCashFlow)}`}
              />
            </div>
          </div>
        ))}
      </div>
      <ChartAxis points={points} />
      <div className="chartLegend">
        <span><i className="legendSwatch revenueLegend" />Revenue</span>
        <span><i className="legendSwatch fcfLegend" />Free cash flow</span>
      </div>
    </>
  );
}

function MultiLineMargins({ points }: { points: HistoricalFinancialPoint[] }) {
  const min = 25;
  const max = 95;
  const grossDots = lineDots(points, (p) => p.grossMargin, min, max);
  const opDots = lineDots(points, (p) => p.operatingMargin, min, max);
  const fcfDots = lineDots(points, (p) => p.fcfMargin, min, max);

  return (
    <>
      <div className="svgChart">
        <svg viewBox="0 0 100 100" role="img" aria-label="Historical margins">
          <path className="chartGridLine" d="M 5 25 L 95 25 M 5 55 L 95 55 M 5 85 L 95 85" />
          <path className="chartLine grossLine" d={linePath(points, (p) => p.grossMargin, min, max)} />
          <path className="chartLine operatingLine" d={linePath(points, (p) => p.operatingMargin, min, max)} />
          <path className="chartLine fcfLine" d={linePath(points, (p) => p.fcfMargin, min, max)} />
          {grossDots.map((dot) => <circle key={`g-${dot.year}`} className="grossDot" cx={dot.x} cy={dot.y} r="1.4" />)}
          {opDots.map((dot) => <circle key={`o-${dot.year}`} className="operatingDot" cx={dot.x} cy={dot.y} r="1.4" />)}
          {fcfDots.map((dot) => <circle key={`f-${dot.year}`} className="fcfDot" cx={dot.x} cy={dot.y} r="1.4" />)}
        </svg>
      </div>
      <ChartAxis points={points} />
      <div className="chartLegend">
        <span><i className="legendSwatch grossLegend" />Gross margin</span>
        <span><i className="legendSwatch operatingLegend" />Operating margin</span>
        <span><i className="legendSwatch fcfMarginLegend" />FCF margin</span>
      </div>
    </>
  );
}

function SingleLineChart({
  points,
  accessor,
  formatter,
  className,
  ariaLabel,
}: {
  points: HistoricalFinancialPoint[];
  accessor: (point: HistoricalFinancialPoint) => number;
  formatter: (value: number) => string;
  className: string;
  ariaLabel: string;
}) {
  const values = points.map(accessor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.18, 1);
  const dots = lineDots(points, accessor, min - pad, max + pad);

  return (
    <>
      <div className="svgChart compactSvgChart">
        <svg viewBox="0 0 100 100" role="img" aria-label={ariaLabel}>
          <path className="chartGridLine" d="M 5 25 L 95 25 M 5 55 L 95 55 M 5 85 L 95 85" />
          <path className={`chartLine ${className}`} d={linePath(points, accessor, min - pad, max + pad)} />
          {dots.map((dot) => (
            <g key={dot.year}>
              <circle className={`${className}Dot`} cx={dot.x} cy={dot.y} r="1.6" />
              <title>{`${dot.year}: ${formatter(dot.value)}`}</title>
            </g>
          ))}
        </svg>
      </div>
      <ChartAxis points={points} />
    </>
  );
}

export function HistoricalFinancials({ ticker }: { ticker: string }) {
  const series = getHistoricalFinancials(ticker);
  if (!series) return null;

  const points = series.points;
  const first = points[0];
  const last = points[points.length - 1];
  const revenueCagr = ((last.revenue / first.revenue) ** (1 / (points.length - 1)) - 1) * 100;
  const fcfCagr = ((last.freeCashFlow / first.freeCashFlow) ** (1 / (points.length - 1)) - 1) * 100;
  const shareReduction = ((last.dilutedShares / first.dilutedShares) - 1) * 100;

  return (
    <section className="historicalSection">
      <div className="historicalHeading">
        <div>
          <span className="panelKicker">5-YEAR FUNDAMENTALS</span>
          <h2>Business performance over time</h2>
        </div>
        <div className="historicalSummaryStats">
          <div><span>Revenue CAGR</span><strong>{revenueCagr.toFixed(1)}%</strong></div>
          <div><span>FCF CAGR</span><strong>{fcfCagr.toFixed(1)}%</strong></div>
          <div><span>Diluted shares</span><strong>{shareReduction.toFixed(1)}%</strong></div>
        </div>
      </div>

      <div className="historicalChartGrid">
        <article className="historicalChartCard wideChartCard">
          <div className="chartCardHeader">
            <div>
              <span>Revenue & cash generation</span>
              <h3>Revenue and free cash flow</h3>
            </div>
            <small>USD · billions</small>
          </div>
          <BarChart points={points} />
        </article>

        <article className="historicalChartCard wideChartCard">
          <div className="chartCardHeader">
            <div>
              <span>Operating economics</span>
              <h3>Margin history</h3>
            </div>
            <small>Percent of revenue</small>
          </div>
          <MultiLineMargins points={points} />
        </article>

        <article className="historicalChartCard">
          <div className="chartCardHeader">
            <div>
              <span>Per-share economics</span>
              <h3>Diluted EPS</h3>
            </div>
            <strong>${last.dilutedEps.toFixed(2)}</strong>
          </div>
          <SingleLineChart
            points={points}
            accessor={(p) => p.dilutedEps}
            formatter={(v) => `$${v.toFixed(2)}`}
            className="epsLine"
            ariaLabel="Diluted EPS history"
          />
        </article>

        {points.every((p) => p.roic != null) ? (
          <article className="historicalChartCard">
            <div className="chartCardHeader">
              <div>
                <span>Capital returns</span>
                <h3>ROIC</h3>
              </div>
              <strong>{last.roic == null ? "—" : `${last.roic.toFixed(1)}%`}</strong>
            </div>
            <SingleLineChart
              points={points}
              accessor={(p) => p.roic ?? 0}
              formatter={(v) => `${v.toFixed(1)}%`}
              className="roicLine"
              ariaLabel="Return on invested capital history"
            />
          </article>
        ) : (
          <article className="historicalChartCard">
            <div className="chartCardHeader">
              <div>
                <span>Cash economics</span>
                <h3>Free cash flow</h3>
              </div>
              <strong>{compact(last.freeCashFlow)}</strong>
            </div>
            <SingleLineChart
              points={points}
              accessor={(p) => p.freeCashFlow}
              formatter={(v) => compact(v)}
              className="roicLine"
              ariaLabel="Free cash flow history"
            />
          </article>
        )}

        <article className="historicalChartCard">
          <div className="chartCardHeader">
            <div>
              <span>Ownership base</span>
              <h3>Diluted share count</h3>
            </div>
            <strong>{last.dilutedShares.toFixed(0)}M</strong>
          </div>
          <SingleLineChart
            points={points}
            accessor={(p) => p.dilutedShares}
            formatter={(v) => `${v.toFixed(1)}M`}
            className="sharesLine"
            ariaLabel="Diluted share count history"
          />
        </article>
      </div>

      <div className="historicalMethodology">
        <div>
          <strong>Methodology</strong>
          <span>FCF: {series.methodology.freeCashFlow}</span>
          <span>ROIC: {series.methodology.roic}</span>
        </div>
        <div className="historicalSources">
          {series.sources.map((source) => (
            <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
              {source.label} ↗
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
