import Link from "next/link";
import type { SolpientListEntry } from "@/lib/solpient-lists-read-model";
import { valuationGap } from "@/lib/solpient-lists-read-model";

function money(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function score(value: number | null) {
  return value == null ? "—" : value.toFixed(1);
}

function gapLabel(gap: number | null) {
  if (gap == null) return "Not valued";
  if (Math.abs(gap) < 1) return "Near fair value";
  return gap > 0 ? `${gap.toFixed(1)}% undervalued` : `${Math.abs(gap).toFixed(1)}% overvalued`;
}

export function SolpientListTable({ rows, empty }: { rows: SolpientListEntry[]; empty: string }) {
  if (!rows.length) {
    return (
      <section className="emptyState">
        <strong>{empty}</strong>
        <p>Fail closed. Incomplete names are not padded into this list.</p>
      </section>
    );
  }

  return (
    <section className="rankingBoard">
      <div className="rankingHeaderRow">
        <span>Rank</span>
        <span>Company</span>
        <span>Readiness</span>
        <span>Decision</span>
        <span>Quality</span>
        <span>Opportunity</span>
        <span>Confidence</span>
        <span>Price</span>
        <span>Fair value</span>
        <span>Gap</span>
      </div>
      {rows.map((row) => {
        const gap = valuationGap(row.price, row.base_fair_value);
        return (
          <Link key={row.ticker} className="rankingRow" href={`/research/${row.ticker}`}>
            <div className="rankCell">
              <span className={`rankBadge rank${Math.min(row.list_rank, 3)}`}>{row.list_rank}</span>
            </div>
            <div className="rankCompany">
              <div>
                <strong>{row.ticker}</strong>
                <span>{row.company_name ?? "—"}</span>
                <small>{row.sector ?? row.industry ?? "Sector pending"}</small>
              </div>
            </div>
            <div className="rankReadiness">
              <strong className={"readinessPill " + (row.readiness_state ?? "building")}>
                {(row.readiness_state ?? "unranked").replaceAll("_", " ")}
              </strong>
            </div>
            <div className="rankScore primaryScore">
              <strong>{score(row.decision_score)}</strong>
            </div>
            <div className="rankScore">
              <strong>{score(row.business_quality_score)}</strong>
            </div>
            <div className="rankScore">
              <strong>{score(row.investment_opportunity_score)}</strong>
            </div>
            <div className="rankScore">
              <strong>{score(row.evidence_confidence_score)}</strong>
            </div>
            <div className="rankMoney">
              <strong>{money(row.price)}</strong>
            </div>
            <div className="rankMoney">
              <strong>{money(row.base_fair_value)}</strong>
            </div>
            <div className="rankValueGap">
              <strong>{gapLabel(gap)}</strong>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
