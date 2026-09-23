# Solpient list pages (SuperGrok)

Stacked on Daily Ranking Engine V1 (`daily-ranking-engine-v1`).

Reads only:

```text
data/rankings/solpient-lists-latest.json
```

produced by `npm run local:daily`. Does not compute 100/20/5.

Routes:

- `/research/focus` Solpient 5
- `/research/core` Solpient 20
- `/research/universe` Solpient 100

ChatGPT can mount `<SolpientListsIntro artifact={artifact} />` at the top of `/research`.

Fail closed empty states when the artifact is missing or a list is short.
