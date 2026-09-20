"use client";

import { useMemo, useState } from "react";
import { getHistoricalFinancials, type HistoricalFinancialPoint } from "@/lib/historical-financials";

function compact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value * 1_000_000);
}

function billions(value: number) {
  return `$${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}B`;
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

function ticks(min: number, max: number, count = 5) {
  const range = max - min || 1;
  return Array.from({ length: count }, (_, index) => max - (range * index) / (count - 1));
}

function selectedX(points: HistoricalFinancialPoint[], selectedYear: number) {
  const index = Math.max(0, points.findIndex((point) => point.fiscalYear === selectedYear));
  return 8 + (index / Math.max(points.length - 1, 1)) * 84;
}

function ChartAxis({
  points,
  selectedYear,
  onSelect,
  offset = false,
}: {
  points: HistoricalFinancialPoint[];
  selectedYear: number;
  onSelect: (year: number) => void;
  offset?: boolean;
}) {
  return (
    <div className={`chartAxis ${offset ? "chartAxisOffset" : ""}`}>
      {points.map((point) => (
        <button
          type="button"
          className={point.fiscalYear === selectedYear ? "chartYear active" : "chartYear"}
          key={point.fiscalYear}
          onClick={() => onSelect(point.fiscalYear)}
          aria-pressed={point.fiscalYear === selectedYear}
        >
          {point.fiscalYear}
        </button>
      ))}
    </div>
  );
}

function YAxis({
  values,
  formatter,
}: {
  values: number[];
  formatter: (value: number) => string;
}) {
  return (
    <div className="chartYAxis" aria-hidden="true">
      {values.map((value, index) => (
        <span key={index}>{formatter(value)}</span>
      ))}
    </div>
  );
}

function BarChart({
  points,
  selectedYear,
  onSelect,
}: {
  points: HistoricalFinancialPoint[];
  selectedYear: number;
  onSelect: (year: number) => void;
}) {
  const maxRaw = Math.max(...points.flatMap((p) => [p.revenue, p.freeCashFlow]));
  const max = Math.ceil(maxRaw / 1000) * 1000;
  const yTicks = ticks(0, max);

  return (
    <>
      <div className="chartWithYAxis">
        <YAxis values={yTicks} formatter={billions} />
        <div className="barChart" aria-label="Revenue and free cash flow history">
          {points.map((point) => {
            const active = point.fiscalYear === selectedYear;
            return (
              <button
                type="button"
                className={active ? "barGroup active" : "barGroup"}
                key={point.fiscalYear}
                onClick={() => onSelect(point.fiscalYear)}
                onMouseEnter={() => onSelect(point.fiscalYear)}
                aria-label={`${point.fiscalYear}: revenue ${billions(point.revenue)}, free cash flow ${billions(point.freeCashFlow)}`}
              >
                <div className="barPair">
                  <div className="barColumn">
                    <span className="barTopLabel">{billions(point.revenue)}</span>
                    <i className="bar revenueBar" style={{ height: `${(point.revenue / max) * 100}%` }} />
                  </div>
                  <div className="barColumn">
                    <span className="barTopLabel">{billions(point.freeCashFlow)}</span>
                    <i className="bar fcfBar" style={{ height: `${(point.freeCashFlow / max) * 100}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <ChartAxis points={points} selectedYear={selectedYear} onSelect={onSelect} offset />
      <div className="chartLegend">
        <span><i className="legendSwatch revenueLegend" />Revenue</span>
        <span><i className="legendSwatch fcfLegend" />Free cash flow</span>
      </div>
    </>
  );
}

function MultiLineMargins({
  points,
  selectedYear,
  onSelect,
}: {
  points: HistoricalFinancialPoint[];
  selectedYear: number;
  onSelect: (year: number) => void;
}) {
  const min = 0;
  const max = 100;
  const yTicks = ticks(min, max);
  const grossDots = lineDots(points, (p) => p.grossMargin, min, max);
  const opDots = lineDots(points, (p) => p.operatingMargin, min, max);
  const fcfDots = lineDots(points, (p) => p.fcfMargin, min, max);
  const x = selectedX(points, selectedYear);

  return (
    <>
      <div className="chartWithYAxis">
        <YAxis values={yTicks} formatter={(v) => `${v.toFixed(0)}%`} />
        <div className="svgChart">
          <svg viewBox="0 0 100 100" role="img" aria-label="Historical margins">
            <path className="chartGridLine" d="M 5 16 L 95 16 M 5 34 L 95 34 M 5 52 L 95 52 M 5 70 L 95 70 M 5 88 L 95 88" />
            <line className="chartCrosshair" x1={x} x2={x} y1="12" y2="92" />
            <path className="chartLine grossLine" d={linePath(points, (p) => p.grossMargin, min, max)} />
            <path className="chartLine operatingLine" d={linePath(points, (p) => p.operatingMargin, min, max)} />
            <path className="chartLine fcfLine" d={linePath(points, (p) => p.fcfMargin, min, max)} />
            {grossDots.map((dot) => <circle key={`g-${dot.year}`} className={dot.year === selectedYear ? "grossDot activeDot" : "grossDot"} cx={dot.x} cy={dot.y} r={dot.year === selectedYear ? "2.3" : "1.4"} />)}
            {opDots.map((dot) => <circle key={`o-${dot.year}`} className={dot.year === selectedYear ? "operatingDot activeDot" : "operatingDot"} cx={dot.x} cy={dot.y} r={dot.year === selectedYear ? "2.3" : "1.4"} />)}
            {fcfDots.map((dot) => <circle key={`f-${dot.year}`} className={dot.year === selectedYear ? "fcfDot activeDot" : "fcfDot"} cx={dot.x} cy={dot.y} r={dot.year === selectedYear ? "2.3" : "1.4"} />)}
            {points.map((point, index) => {
              const slot = 84 / Math.max(points.length - 1, 1);
              const pointX = 8 + index * slot;
              return (
                <rect
                  key={point.fiscalYear}
                  x={pointX - slot / 2}
                  y="10"
                  width={slot}
                  height="82"
                  fill="transparent"
                  className="chartHitArea"
                  onMouseEnter={() => onSelect(point.fiscalYear)}
                  onClick={() => onSelect(point.fiscalYear)}
                />
              );
            })}
          </svg>
        </div>
      </div>
      <ChartAxis points={points} selectedYear={selectedYear} onSelect={onSelect} offset />
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
  axisFormatter,
  className,
  ariaLabel,
  selectedYear,
  onSelect,
}: {
  points: HistoricalFinancialPoint[];
  accessor: (point: HistoricalFinancialPoint) => number;
  formatter: (value: number) => string;
  axisFormatter?: (value: number) => string;
  className: string;
  ariaLabel: string;
  selectedYear: number;
  onSelect: (year: number) => void;
}) {
  const values = points.map(accessor);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.18, rawMax === rawMin ? Math.max(rawMax * 0.1, 1) : 0.25);
  const min = Math.max(0, rawMin - pad);
  const max = rawMax + pad;
  const dots = lineDots(points, accessor, min, max);
  const yTicks = ticks(min, max);
  const x = selectedX(points, selectedYear);

  return (
    <>
      <div className="chartWithYAxis compactChartWithYAxis">
        <YAxis values={yTicks} formatter={axisFormatter ?? formatter} />
        <div className="svgChart compactSvgChart">
          <svg viewBox="0 0 100 100" role="img" aria-label={ariaLabel}>
            <path className="chartGridLine" d="M 5 16 L 95 16 M 5 34 L 95 34 M 5 52 L 95 52 M 5 70 L 95 70 M 5 88 L 95 88" />
            <line className="chartCrosshair" x1={x} x2={x} y1="12" y2="92" />
            <path className={`chartLine ${className}`} d={linePath(points, accessor, min, max)} />
            {dots.map((dot) => (
              <g key={dot.year}>
                <circle className={`${className}Dot ${dot.year === selectedYear ? "activeDot" : ""}`} cx={dot.x} cy={dot.y} r={dot.year === selectedYear ? "2.5" : "1.6"} />
                <title>{`${dot.year}: ${formatter(dot.value)}`}</title>
              </g>
            ))}
            {points.map((point, index) => {
              const slot = 84 / Math.max(points.length - 1, 1);
              const pointX = 8 + index * slot;
              return (
                <rect
                  key={point.fiscalYear}
                  x={pointX - slot / 2}
                  y="10"
                  width={slot}
                  height="82"
                  fill="transparent"
                  className="chartHitArea"
                  onMouseEnter={() => onSelect(point.fiscalYear)}
                  onClick={() => onSelect(point.fiscalYear)}
                />
              );
            })}
          </svg>
        </div>
      </div>
      <ChartAxis points={points} selectedYear={selectedYear} onSelect={onSelect} offset />
    </>
  );
}

export function HistoricalFinancials({ ticker }: { ticker: string }) {
  const series = getHistoricalFinancials(ticker);
  const points = series?.points ?? [];
  const [selectedYear, setSelectedYear] = useState(points.at(-1)?.fiscalYear ?? new Date().getFullYear());

  const activePoint = useMemo(
    () => points.find((point) => point.fiscalYear === selectedYear) ?? points.at(-1),
    [points, selectedYear]
  );

  if (!series || !points.length || !activePoint) return null;

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
          <p className="historicalHint">Hover a chart or select a year to inspect the same period across every metric.</p>
        </div>
        <div className="historicalSummaryStats">
          <div><span>Revenue CAGR</span><strong>{revenueCagr.toFixed(1)}%</strong></div>
          <div><span>FCF CAGR</span><strong>{fcfCagr.toFixed(1)}%</strong></div>
          <div><span>Diluted shares</span><strong>{shareReduction.toFixed(1)}%</strong></div>
        </div>
      </div>

      <div className="historicalYearSelector" role="group" aria-label="Select fiscal year">
        {points.map((point) => (
          <button
            type="button"
            key={point.fiscalYear}
            className={point.fiscalYear === selectedYear ? "active" : ""}
            onClick={() => setSelectedYear(point.fiscalYear)}
            aria-pressed={point.fiscalYear === selectedYear}
          >
            FY{point.fiscalYear}
          </button>
        ))}
      </div>

      <div className="historicalInspector" aria-live="polite">
        <div>
          <span>Selected period</span>
          <strong>FY{activePoint.fiscalYear}</strong>
        </div>
        <div>
          <span>Revenue</span>
          <strong>{billions(activePoint.revenue)}</strong>
        </div>
        <div>
          <span>Free cash flow</span>
          <strong>{billions(activePoint.freeCashFlow)}</strong>
        </div>
        <div>
          <span>Gross margin</span>
          <strong>{activePoint.grossMargin.toFixed(1)}%</strong>
        </div>
        <div>
          <span>Operating margin</span>
          <strong>{activePoint.operatingMargin.toFixed(1)}%</strong>
        </div>
        <div>
          <span>FCF margin</span>
          <strong>{activePoint.fcfMargin.toFixed(1)}%</strong>
        </div>
        <div>
          <span>Diluted EPS</span>
          <strong>${activePoint.dilutedEps.toFixed(2)}</strong>
        </div>
        <div>
          <span>Diluted shares</span>
          <strong>{activePoint.dilutedShares.toFixed(1)}M</strong>
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
          <BarChart points={points} selectedYear={selectedYear} onSelect={setSelectedYear} />
        </article>

        <article className="historicalChartCard wideChartCard">
          <div className="chartCardHeader">
            <div>
              <span>Operating economics</span>
              <h3>Margin history</h3>
            </div>
            <small>Percent of revenue</small>
          </div>
          <MultiLineMargins points={points} selectedYear={selectedYear} onSelect={setSelectedYear} />
        </article>

        <article className="historicalChartCard">
          <div className="chartCardHeader">
            <div>
              <span>Per-share economics</span>
              <h3>Diluted EPS</h3>
            </div>
            <strong>${activePoint.dilutedEps.toFixed(2)}</strong>
          </div>
          <SingleLineChart
            points={points}
            accessor={(p) => p.dilutedEps}
            formatter={(v) => `$${v.toFixed(2)}`}
            axisFormatter={(v) => `$${v.toFixed(1)}`}
            className="epsLine"
            ariaLabel="Diluted EPS history"
            selectedYear={selectedYear}
            onSelect={setSelectedYear}
          />
        </article>

        {points.every((p) => p.roic != null) ? (
          <article className="historicalChartCard">
            <div className="chartCardHeader">
              <div>
                <span>Capital returns</span>
                <h3>ROIC</h3>
              </div>
              <strong>{activePoint.roic == null ? "—" : `${activePoint.roic.toFixed(1)}%`}</strong>
            </div>
            <SingleLineChart
              points={points}
              accessor={(p) => p.roic ?? 0}
              formatter={(v) => `${v.toFixed(1)}%`}
              axisFormatter={(v) => `${v.toFixed(0)}%`}
              className="roicLine"
              ariaLabel="Return on invested capital history"
              selectedYear={selectedYear}
              onSelect={setSelectedYear}
            />
          </article>
        ) : (
          <article className="historicalChartCard">
            <div className="chartCardHeader">
              <div>
                <span>Cash economics</span>
                <h3>Free cash flow</h3>
              </div>
              <strong>{billions(activePoint.freeCashFlow)}</strong>
            </div>
            <SingleLineChart
              points={points}
              accessor={(p) => p.freeCashFlow}
              formatter={(v) => billions(v)}
              axisFormatter={(v) => billions(v)}
              className="roicLine"
              ariaLabel="Free cash flow history"
              selectedYear={selectedYear}
              onSelect={setSelectedYear}
            />
          </article>
        )}

        <article className="historicalChartCard">
          <div className="chartCardHeader">
            <div>
              <span>Ownership base</span>
              <h3>Diluted share count</h3>
            </div>
            <strong>{activePoint.dilutedShares.toFixed(1)}M</strong>
          </div>
          <SingleLineChart
            points={points}
            accessor={(p) => p.dilutedShares}
            formatter={(v) => `${v.toFixed(1)}M`}
            axisFormatter={(v) => `${v.toFixed(0)}M`}
            className="sharesLine"
            ariaLabel="Diluted share count history"
            selectedYear={selectedYear}
            onSelect={setSelectedYear}
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
