import Link from "next/link";
import type { SolpientListsArtifact } from "@/lib/solpient-lists-read-model";
import { valuationGap } from "@/lib/solpient-lists-read-model";

export function SolpientListsIntro({ artifact }: { artifact: SolpientListsArtifact | null }) {
  if (!artifact) {
    return (
      <section className="rankingMethod">
        <div>
          <strong>Solpient 5 / 20 / 100</strong>
          <span>
            Daily list artifact not found. After npm run local:daily this page reads
            data/rankings/solpient-lists-latest.json. Published research ranking remains below.
          </span>
        </div>
        <div>
          <Link href="/research/universe">Universe</Link>
          {" · "}
          <Link href="/research/core">Core</Link>
          {" · "}
          <Link href="/research/focus">Focus</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rankingMethod">
      <div>
        <strong>Solpient 5 · {artifact.counts.solpient_5}</strong>
        <span>
          {artifact.solpient_5.length
            ? artifact.solpient_5
                .map((row) => {
                  const gap = valuationGap(row.price, row.base_fair_value);
                  const gapText =
                    gap == null ? "" : gap > 0 ? ` ${gap.toFixed(0)}% undervalued` : ` ${Math.abs(gap).toFixed(0)}% overvalued`;
                  return `#${row.list_rank} ${row.ticker}${gapText}`;
                })
                .join(" · ")
            : "None Decision Ready. Fail closed."}
        </span>
      </div>
      <div>
        <strong>
          20: {artifact.counts.solpient_20}
          {artifact.complete.solpient_20 ? "" : " (short)"} · 100: {artifact.counts.solpient_100}
        </strong>
        <span>
          <Link href="/research/focus">Focus</Link>
          {" · "}
          <Link href="/research/core">Core</Link>
          {" · "}
          <Link href="/research/universe">Universe</Link>
          {" · methodology "}
          {artifact.methodology_version}
        </span>
      </div>
    </section>
  );
}
