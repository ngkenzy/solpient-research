# Historical + Peer Context Engine v1

This engine supplies Research Standard v2 with comparable historical and peer evidence without pretending the source store is deeper than it is.

## Outputs

For every tracked company it materializes:

- quarterly and annual historical metric observations from stored normalized fundamentals;
- annual growth and per-share trends when enough history exists;
- capital-allocation history from dividends, repurchases, stock-based compensation, acquisitions and debt issuance/repayment fields;
- point-in-time P/E and, where economically appropriate, price/FCF and FCF yield from stored market snapshots;
- an explicit peer set;
- peer metric snapshots for peers already tracked by Solpient;
- a private research context pack describing coverage, trends, peers, capital allocation and limitations.

External reference peers can be configured even when their financial data is not yet ingested. Their status remains `not_ingested` rather than being fabricated.

## Research integrity rules

The engine never manufactures missing years. If normalized fundamentals cover fewer than five complete fiscal years, the context pack says so. Historical valuation is not described as 3/5/10-year history unless the underlying market history supports it.

Banks do not use free-cash-flow valuation ratios as a default comparison.

Peer sets are analyst configuration, not automatic ranking conclusions.

## Baseline integration

The Baseline Factory attaches the latest private context pack to `factory.research_context`. A batch generator creates private drafts only for tracked companies that do not already have a complete published research run or an existing baseline draft.

Nothing in this engine auto-publishes research.
