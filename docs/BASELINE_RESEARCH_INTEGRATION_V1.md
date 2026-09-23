# Baseline Research Integration V1

## Goal

Give every governed Solpient 100 member useful evidence-grounded analysis without creating a second research pipeline.

This branch integrates:

- Baseline Research Contract V1
- Baseline Research Composer V1
- resumable batch execution
- optional private persistence
- existing company-page fallback

It does not alter Solpient 100 / 20 / 5 membership or Phase 3 ranking.

## Canonical flow

\`\`\`text
Governed Solpient 100
  -> baseline:packs
  -> one hashed evidence pack per ticker
  -> composeBaselineResearch(pack)
  -> canonical validation
  -> local composition artifact
  -> optional private research_compositions persistence
  -> existing /research/<TICKER> page
\`\`\`

Published full research remains authoritative whenever it exists.

## Important evidence rules

- Company identity is a citable evidence item.
- Reviewed sector assignment is a citable evidence item.
- Evidence gaps are citable evidence items.
- Bank universal-metric requirements exclude generic corporate FCF metrics that are economically inappropriate.
- Unsupported sections remain \`insufficient_evidence\`.
- A valid composition does not automatically become Baseline Ready.
- Research Ready and Decision Ready remain controlled by the existing governed methodology.

## Batch reliability

\`Baseline Research Batch V1\`:

- uses one checkpoint per ticker
- atomically writes output and checkpoint JSON
- skips successful unchanged evidence-pack hashes
- retries failed or changed tickers
- continues when one ticker fails
- fails closed at the batch summary when any selected ticker fails
- can run without database writes
- persists only structurally valid compositions when \`--persist\` is explicitly requested
- never publishes a research run

The shared pipeline lock prevents two baseline batch writers from running concurrently.

## Five-name proof

Use:

- ADBE — software
- PFE — biopharma
- JPM — bank
- XOM — energy / generic operating-company case
- AMT — REIT / unsupported-module review case

Run:

\`\`\`bash
npm run test:baseline-contract
npm run test:baseline-composer
npm run test:baseline-batch

npm run baseline:packs:proof
npm run baseline:compose:proof
\`\`\`

Inspect:

\`\`\`text
data/baseline-research/index.json
data/baseline-research/packs/<TICKER>.json
data/baseline-research/compositions/<TICKER>.json
data/baseline-research/batch-checkpoint-v1.json
\`\`\`

After the five-name proof is clean, private persistence can be tested:

\`\`\`bash
npm run baseline:compose:persist -- --tickers=ADBE,PFE,JPM,XOM,AMT
\`\`\`

Persistence writes only to existing \`research_compositions\` rows and does not publish research.

## Full 100

Once the proof is accepted:

\`\`\`bash
npm run baseline:packs
npm run baseline:compose:batch
\`\`\`

After reviewing the local batch summary:

\`\`\`bash
npm run baseline:compose:persist
\`\`\`

Existing company pages show the latest valid persisted baseline only when no published research version exists.

## Supabase/public deployment note

The current Supabase RLS keeps generated \`research_compositions\` private. Direct local PostgreSQL can display persisted baseline compositions through the server read model.

Do not loosen public RLS until the five-name live proof is reviewed. A later public read policy or sanitized read model should expose only validated baseline artifacts deliberately.
