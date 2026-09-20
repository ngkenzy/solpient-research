# Adaptive Fundamentals Source Engine

Fallback order: SEC Company Facts -> Yahoo fundamentals time-series -> FMP where entitled -> Alpha Vantage -> explicit unavailable.

Yahoo is a temporary structured fallback stored as `yahoo_fundamentals`, marked `temporary_source: true`, and ranked below SEC/FMP. It is never primary-source evidence for publication. A quality gate requires at least four quarterly rows, four annual rows, >=70% core-field coverage, and balance-sheet coverage before rows are written. Baseline TTM excludes annual rows; historical analysis can use annual rows and de-duplicates overlapping providers.