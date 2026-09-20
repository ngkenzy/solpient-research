import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

function n(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value: unknown, unit?: string | null) {
  const v = n(value);
  if (v == null) return "—";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "$") return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(v);
  return new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(v);
}

export async function PredictionHistory({ companyId, ticker }: { companyId: string; ticker: string }) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: snapshots } = await supabase
    .from("prediction_snapshots")
    .select("id,prediction_key,predicted_at,model_version,horizon_months,benchmark_ticker,price_at_prediction,confidence,thesis_status,rationale")
    .eq("company_id", companyId)
    .order("predicted_at", { ascending: false })
    .limit(12);

  const rows = snapshots ?? [];
  if (rows.length === 0) {
    return (
      <section className="dashboardPanel intelligenceHistoryPanel">
        <div className="panelHeader">
          <div>
            <span className="panelKicker">SOLPIENT INTELLIGENCE</span>
            <h2>Prediction history</h2>
          </div>
          <small>Append-only ledger</small>
        </div>
        <div className="baselineNote">
          <strong>No locked predictions yet.</strong>
          <p>
            The intelligence database is ready. Future prediction snapshots for {ticker} will be
            preserved here exactly as they were known at the time, then scored against realized outcomes.
          </p>
        </div>
      </section>
    );
  }

  const ids = rows.map((r) => r.id);
  const { data: outcomes } = await supabase
    .from("prediction_outcomes")
    .select("id,prediction_snapshot_id,metric_key,label,predicted_value,predicted_low,predicted_high,predicted_probability,predicted_text,unit,target_date")
    .in("prediction_snapshot_id", ids);

  const outcomeIds = (outcomes ?? []).map((o) => o.id);
  const { data: realized } = outcomeIds.length
    ? await supabase
        .from("realized_outcomes")
        .select("prediction_outcome_id,observed_at,actual_value,actual_text")
        .in("prediction_outcome_id", outcomeIds)
        .order("observed_at", { ascending: false })
    : { data: [] as any[] };

  const latestRealized = new Map<string, any>();
  for (const item of realized ?? []) {
    if (!latestRealized.has(item.prediction_outcome_id)) latestRealized.set(item.prediction_outcome_id, item);
  }

  return (
    <section className="dashboardPanel intelligenceHistoryPanel">
      <div className="panelHeader">
        <div>
          <span className="panelKicker">SOLPIENT INTELLIGENCE</span>
          <h2>Prediction history</h2>
        </div>
        <small>{rows.length} locked snapshot{rows.length === 1 ? "" : "s"}</small>
      </div>

      <div className="historyList">
        {rows.map((snapshot) => {
          const snapshotOutcomes = (outcomes ?? []).filter((o) => o.prediction_snapshot_id === snapshot.id);
          return (
            <article className="predictionLedgerRow" key={snapshot.id}>
              <div className="predictionLedgerHead">
                <div>
                  <strong>{new Date(snapshot.predicted_at).toLocaleDateString("en-US")}</strong>
                  <small>{snapshot.model_version} · {snapshot.horizon_months}mo · vs {snapshot.benchmark_ticker}</small>
                </div>
                <div>
                  <span className={`predictionStatus ${snapshot.thesis_status ?? "intact"}`}>
                    {snapshot.thesis_status ?? "intact"}
                  </span>
                  <strong>{snapshot.confidence == null ? "—" : `${Math.round(Number(snapshot.confidence))}% confidence`}</strong>
                </div>
              </div>

              {snapshot.rationale ? <p className="predictionRationale">{snapshot.rationale}</p> : null}

              <div className="predictionOutcomeGrid">
                {snapshotOutcomes.slice(0, 6).map((outcome) => {
                  const actual = latestRealized.get(outcome.id);
                  const predicted = outcome.predicted_text ??
                    (outcome.predicted_low != null || outcome.predicted_high != null
                      ? `${fmt(outcome.predicted_low, outcome.unit)}–${fmt(outcome.predicted_high, outcome.unit)}`
                      : fmt(outcome.predicted_value, outcome.unit));
                  const actualText = actual?.actual_text ?? fmt(actual?.actual_value, outcome.unit);
                  return (
                    <div className="predictionOutcomeTile" key={outcome.id}>
                      <span>{outcome.label}</span>
                      <strong>{predicted}</strong>
                      <small>{actual ? `Actual: ${actualText}` : outcome.target_date ? `Target: ${new Date(outcome.target_date + "T00:00:00Z").toLocaleDateString("en-US")}` : "Awaiting outcome"}</small>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      <p className="intelligenceFootnote">
        Historical predictions are never overwritten. New evidence creates a new snapshot; realized results are linked back later for error analysis and model calibration.
      </p>
    </section>
  );
}
