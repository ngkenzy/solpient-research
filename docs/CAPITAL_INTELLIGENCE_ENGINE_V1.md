# Capital Intelligence Engine v1

SOLPIENT Capital Intelligence turns official SEC ownership disclosures into normalized company-level activity for the full tracked universe.

## Sources

### Insider activity
- SEC Form 4
- Only open-market transaction codes **P** (purchase) and **S** (sale) are classified as buys/sells.
- Grants, option exercises, tax withholding and other transaction codes are not relabeled as discretionary buys or sells.

### Notable investors
- SEC Form 13F-HR information tables
- The latest quarter is compared with the prior reported quarter.
- Positions are classified as New, Increased, Reduced, Reported, or Exited.
- Options rows with Put/Call designations are excluded from the long-equity ownership panel.
- 13F values use the current SEC filing convention: value to the nearest dollar.

Tracked managers currently include AQR, D. E. Shaw, Greenlight, Citadel, PRIMECAP, Dodge & Cox, Berkshire Hathaway, Pershing Square, Soros Fund Management, and Bridgewater.

## Matching

13F does not provide stock tickers. The engine normalizes issuer legal names and matches them against SOLPIENT's tracked company names. Ambiguous names are left unmatched rather than guessed.

## Political disclosures

The schema and UI continue to support political transaction records, but v1 does not pretend SEC Form 4/13F data contains congressional transactions. Political disclosures remain a separate provider adapter.

## Automation

`Capital Intelligence` runs on weekdays and can also be dispatched manually. It:

1. reads the 22 tracked companies and notable-manager list
2. fetches recent SEC Form 4 filings
3. parses real open-market insider purchases/sales
4. fetches each manager's two latest 13F periods
5. calculates quarter-over-quarter position changes
6. upserts normalized rows into `capital_activity`
7. refreshes `intelligence_events`

Run locally with:

`npm run sync:capital-intelligence`

Tests:

`npm run test:capital-intelligence`
