# Baseline Research Composer V1

Isolated Grok module. Not a factory.

```bash
node scripts/test-baseline-research-composer-v1.mjs

# after local pack generation
npm run baseline:packs:proof
node scripts/compose-baseline-research-v1.mjs --pack=data/baseline-research/packs/ADBE.json --output=data/baseline-research/compositions/ADBE.json
npm run baseline:validate -- --pack=data/baseline-research/packs/ADBE.json --output=data/baseline-research/compositions/ADBE.json
```

`composeBaselineResearch(pack)` returns Composer Output V1 only.
It does not write the database, change ranking, or calculate new metrics.
