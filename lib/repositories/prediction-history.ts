import "server-only";

import { databaseConfigured, dbQuery } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";

export async function loadPredictionHistoryData(
  companyId: string,
  asOf: string | null,
) {
  if (databaseConfigured()) {
    const snapshots = await dbQuery<any>(
      asOf
        ? `
            select id,prediction_key,predicted_at,model_version,horizon_months,benchmark_ticker,
                   price_at_prediction,confidence,thesis_status,rationale
            from public.prediction_snapshots
            where company_id=$1 and predicted_at <= $2::timestamptz
            order by predicted_at desc
            limit 12
          `
        : `
            select id,prediction_key,predicted_at,model_version,horizon_months,benchmark_ticker,
                   price_at_prediction,confidence,thesis_status,rationale
            from public.prediction_snapshots
            where company_id=$1
            order by predicted_at desc
            limit 12
          `,
      asOf ? [companyId, asOf] : [companyId],
    );

    if (!snapshots.length) {
      return { source: "postgres" as const, snapshots, outcomes: [], realized: [] };
    }

    const snapshotIds = snapshots.map((row) => row.id);
    const outcomes = await dbQuery<any>(
      `
        select id,prediction_snapshot_id,metric_key,label,predicted_value,predicted_low,predicted_high,
               predicted_probability,predicted_text,unit,target_date
        from public.prediction_outcomes
        where prediction_snapshot_id = any($1::uuid[])
      `,
      [snapshotIds],
    );

    const outcomeIds = outcomes.map((row) => row.id);
    const realized = outcomeIds.length
      ? await dbQuery<any>(
          asOf
            ? `
                select prediction_outcome_id,observed_at,actual_value,actual_text
                from public.realized_outcomes
                where prediction_outcome_id = any($1::uuid[])
                  and observed_at <= $2::timestamptz
                order by observed_at desc
              `
            : `
                select prediction_outcome_id,observed_at,actual_value,actual_text
                from public.realized_outcomes
                where prediction_outcome_id = any($1::uuid[])
                order by observed_at desc
              `,
          asOf ? [outcomeIds, asOf] : [outcomeIds],
        )
      : [];

    return { source: "postgres" as const, snapshots, outcomes, realized };
  }

  const supabase = getSupabase();
  if (!supabase) return null;

  let snapshotQuery = supabase
    .from("prediction_snapshots")
    .select("id,prediction_key,predicted_at,model_version,horizon_months,benchmark_ticker,price_at_prediction,confidence,thesis_status,rationale")
    .eq("company_id", companyId);
  if (asOf) snapshotQuery = snapshotQuery.lte("predicted_at", asOf);
  const { data: snapshots } = await snapshotQuery
    .order("predicted_at", { ascending: false })
    .limit(12);

  const rows = snapshots ?? [];
  if (!rows.length) {
    return { source: "supabase" as const, snapshots: rows, outcomes: [], realized: [] };
  }

  const snapshotIds = rows.map((row) => row.id);
  const { data: outcomes } = await supabase
    .from("prediction_outcomes")
    .select("id,prediction_snapshot_id,metric_key,label,predicted_value,predicted_low,predicted_high,predicted_probability,predicted_text,unit,target_date")
    .in("prediction_snapshot_id", snapshotIds);

  const outcomeIds = (outcomes ?? []).map((row) => row.id);
  let realizedQuery = outcomeIds.length
    ? supabase
        .from("realized_outcomes")
        .select("prediction_outcome_id,observed_at,actual_value,actual_text")
        .in("prediction_outcome_id", outcomeIds)
    : null;

  if (realizedQuery && asOf) realizedQuery = realizedQuery.lte("observed_at", asOf);

  const { data: realized } = realizedQuery
    ? await realizedQuery.order("observed_at", { ascending: false })
    : { data: [] as any[] };

  return {
    source: "supabase" as const,
    snapshots: rows,
    outcomes: outcomes ?? [],
    realized: realized ?? [],
  };
}
