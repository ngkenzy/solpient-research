# Solpient Sector Classification Coverage V2.3

## Goal

**No obvious operating company remains `Unknown`; only genuinely ambiguous or insufficient-data names remain in the review queue.**

V2.3 is a taxonomy-coverage release. It does not change scoring thresholds, Sector Evidence V2.1 ceilings, financial scoring, or sector quotas.

## Why V2.3 exists

The V2.2 full-universe audit still surfaced clearly classifiable operating companies as `Unknown/general`, including textile manufacturers, construction companies, publishers, instrumentation companies, consumer-product businesses, Walmart, Waters, Veralto, Vontier, and others.

The failure was systematic SIC coverage, not scoring.

## Classification hierarchy

V2.3 preserves all V2.2 classifications and adds coverage only when V2.2 remains unresolved:

1. reviewed V2.3 issuer override
2. reviewed V2.3 issuer review queue
3. V2.2 classifier
4. safe SIC-family / description coverage
5. explicit `review_required`

There is no catch-all sector guess.

## Safe SIC-family coverage

V2.3 adds deterministic coverage for:

- 0100–0999 Agriculture → Consumer Staples
- 1500–1799 Construction → Industrials
- 2200–2399 Textiles/Apparel → Consumer Discretionary
- 2700–2749 Publishing → Communication Services
- 2900–2999 Petroleum Products → Energy
- 3000–3099 Rubber/Plastic Products → Materials
- 3100–3199 Leather Goods → Consumer Discretionary
- 3826 / laboratory analytical instruments → Health Care
- 3824/3825 industrial instrumentation descriptions → Industrials
- 3940–3949 Sporting/Leisure Goods → Consumer Discretionary
- 5331 / variety retail → Consumer Staples

The rules are applied only after V2.2 fails to classify a company, so previously validated V2/V2.2 mappings are preserved.

## Reviewed issuer overrides

V2.3 includes narrow issuer-level repairs where SEC SIC is stale or economically misleading:

- UHAL → Industrials / Ground Transportation & Equipment Rental
- UNF → Industrials / Commercial Services & Supplies
- VFF → Consumer Staples / Agricultural & Plant-Based Consumer Products
- VLTO → Industrials / Environmental & Water Technology
- VNT → Industrials / Industrial Technology
- VTSI → Industrials / Aerospace, Defense & Training Systems
- VVV → Consumer Discretionary / Automotive Services
- WAT → Health Care / Life Sciences Tools & Diagnostics
- WBTN → Communication Services / Interactive Media & Entertainment
- WHF → Financials / Business Development Companies
- WMS → Industrials / Building Products
- WMT → Consumer Staples / Consumer Staples Distribution & Retail
- YETI → Consumer Discretionary / Leisure Products

## Review queue

V2.3 introduces an explicit `review_required` classification method.

A company remains sector `Unknown` only when the available data is genuinely ambiguous or insufficient. It receives:

- `classification_review_required=true`
- a human-readable `classification_review_reason`
- low classification confidence
- the existing Unknown evidence cap, preventing automated Solpient 100 Candidate promotion

Initial reviewed queue examples:

- VAI — mobility/leasing/finance mix
- WW — consumer subscription + weight-management + clinical/telehealth mix
- XWEL — announced divestiture and strategic transition

Broad SICs such as 7200 Personal Services, 7510 Auto Rental & Leasing, and 3990 Miscellaneous Manufacturing also enter review when no issuer-specific evidence resolves them.

## Audit contract

`audit:sector-classification` now reports separately:

- `review_required_count`
- `unresolved_count`
- `obvious_unknown_count`
- `review_queue`
- `unresolved`
- `obvious_unknown`

The V2.3 acceptance target is:

`obvious_unknown_count = 0`

A nonzero review queue is acceptable when every remaining name is genuinely ambiguous or data-insufficient.

## Historical integrity

V2.2 screening and candidate-pipeline code are frozen.

New live versions:

- `solpient-universe-sector-model-v2.3`
- `solpient-universe-screen-v2.3`
- `solpient-100-selection-v2.3`
- `research-candidate-pipeline-v2.3`

V1, V2, V2.1, and V2.2 historical runs remain reproducible.
