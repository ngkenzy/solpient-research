# SOLPIENT Review & Promotion Workbench

The workbench separates automated evidence collection from human/research judgment.

## State machine
baseline draft → saved review → ready review → deliberate promotion → immutable published research run.

A draft can never publish itself.

## Promotion gates
Promotion requires a complete SOLPIENT Research Standard v1 package, a reviewed summary and business assessment, seven reviewed scores, bear/base/bull values, material risks with thesis breakers, monitored thesis conditions, all nine 3/5/10-year expected-return scenarios, and at least one verified SEC filing source. Predictions remain separate.

## Web access
The private route is /review and is not linked from public navigation. It requires REVIEW_WORKBENCH_KEY plus SUPABASE_SECRET_KEY (preferred) or the legacy SUPABASE_SERVICE_ROLE_KEY on the server. The browser receives only an HTTP-only fingerprint cookie scoped to /review.

## GitHub fallback
Authorized repository users can run the Promote reviewed baseline workflow with a draft UUID and reviewed JSON patch. It uses the same validator and promotion engine as the web workbench.
