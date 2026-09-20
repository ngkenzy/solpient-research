# SOLPIENT Data Coverage Engine v1

The Data Coverage Engine fills the evidence layer before Research Standard v2 attempts deeper analysis.

## Provider order

1. **SEC Company Facts** — primary-source XBRL from data.sec.gov.
2. **Financial Modeling Prep** — normalized fallback when the subscribed endpoint is available.
3. **Alpha Vantage** — quota-limited fallback for companies still missing normalized periods.
4. **Explicitly unavailable** — the system records the gap instead of inventing a value.

A higher-priority provider wins when more than one provider supplies the same fiscal period. Provider-specific snapshots remain in the database for auditability.

## Primary-source backfill

The SEC adapter requests each tracked company's Company Facts file and normalizes up to 44 quarters. It supports:

- revenue;
- net income;
- operating cash flow;
- capital expenditure and derived FCF;
- diluted shares and EPS when quarter-specific values are defensible;
- gross profit, operating income, interest expense, R&D and SBC;
- dividends, buybacks, acquisitions and debt flows;
- cash, debt, assets, liabilities, equity, retained earnings and liquidity fields.

For cumulative 10-Q cash-flow or income facts, Q2 and Q3 can be mechanically derived from year-to-date disclosures. Q4 additive flow metrics can be derived from the 10-K less the first nine months. Non-additive metrics such as diluted EPS and weighted-average shares are not created by subtracting annual values.

Every SEC-normalized row stores the Company Facts URL, accession references, selected tags and whether a value was reported or mechanically derived.

## Historical market coverage

The current market-history adapter uses Yahoo's chart endpoint as a temporary source. On first run it requests long history; later runs use a short incremental window. This is intentionally isolated behind provider provenance because it is not the long-term commercial data source.

Historical market capitalization is estimated from the closest prior normalized diluted-share observation when available.

## Coverage score

Every tracked company receives a private coverage report with:

- fundamentals coverage;
- balance-sheet coverage;
- five-year history coverage;
- market-history coverage;
- industry-module coverage;
- peer-data coverage;
- overall coverage;
- missing fields;
- provider mix;
- explicit limitations.

Coverage status is **sufficient**, **partial**, or **blocked**. This is a data-readiness status, not an investment rating.

## Baseline refresh

After new data arrives, Solpient refreshes only private baseline drafts that have not entered human review. Reviewed drafts are preserved. Nothing in the Data Coverage Engine publishes research.

## Daily operation

The daily intelligence workflow now runs primary-source SEC normalization before provider fallbacks, refreshes market history, rebuilds historical/peer context, recomputes coverage, and refreshes untouched private baselines.

The separate Data Coverage workflow can also be run manually and stores JSON artifacts for inspection.
