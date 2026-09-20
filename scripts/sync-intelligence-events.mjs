import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { materialityForCapitalActivity } from "../lib/capital-intelligence-orchestrator.mjs";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function startRun() {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ pipeline: "intelligence_events", status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function finishRun(id, status, records, message, details = {}) {
  const { error } = await supabase
    .from("automation_runs")
    .update({
      status,
      records_written: records,
      message,
      details,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

function filingRow(row) {
  return {
    company_id: row.company_id,
    source_kind: "filing",
    source_id: row.id,
    event_type: "filing",
    occurred_at: row.filed_at,
    disclosed_at: row.accepted_at ?? (row.filed_at ? row.filed_at + "T00:00:00Z" : null),
    title: "New " + row.form_type + " filing",
    summary: row.title ?? "New public filing detected.",
    materiality: ["10-K", "10-Q", "8-K"].includes(row.form_type) ? "review" : "info",
    review_status: "open",
    source_url: row.filing_url,
    metadata: { form_type: row.form_type, provider: row.provider },
    updated_at: new Date().toISOString(),
  };
}

function activityRow(row) {
  const occurred = row.transaction_date ?? row.position_date ?? null;
  const dateSource = row.transaction_date
    ? "transaction_date"
    : row.position_date
      ? "position_date"
      : "unknown";

  let summary = "Public capital activity recorded.";
  if (row.activity_type === "institutional") {
    summary = (row.actor_detail ?? row.actor_name) + " reported ownership activity.";
  } else if (row.activity_type === "insider") {
    summary = (row.actor_detail ?? "Insider") + " transaction recorded.";
  } else if (row.activity_type === "political") {
    summary = (row.actor_detail ?? "Public official") + " transaction disclosure recorded.";
  }

  return {
    company_id: row.company_id,
    source_kind: "capital_activity",
    source_id: row.id,
    event_type: row.activity_type,
    occurred_at: occurred,
    disclosed_at: row.disclosure_date ? row.disclosure_date + "T00:00:00Z" : null,
    title: row.actor_name + " · " + row.action,
    summary,
    materiality: materialityForCapitalActivity(row),
    review_status: "open",
    source_url: row.source_url,
    metadata: {
      action: row.action,
      shares: row.shares,
      price: row.price,
      value: row.value,
      change_pct: row.change_pct,
      amount_range: row.amount_range,
      position_date: row.position_date,
      date_source: dateSource,
      provider: row.provider,
    },
    updated_at: new Date().toISOString(),
  };
}

function changeRow(row) {
  return {
    company_id: row.company_id,
    source_kind: "research_change",
    source_id: row.id,
    event_type: "research_change",
    occurred_at: row.research_runs?.researched_at?.slice(0, 10) ?? null,
    disclosed_at: row.research_runs?.researched_at ?? row.created_at,
    title: row.label,
    summary: row.summary,
    materiality: row.materiality === "material" ? "review" : "info",
    review_status: "incorporated",
    research_run_id: row.current_run_id,
    source_url: null,
    metadata: {
      direction: row.direction,
      category: row.category,
      metric_key: row.metric_key,
      old_value: row.old_value,
      new_value: row.new_value,
      old_text: row.old_text,
      new_text: row.new_text,
    },
    updated_at: new Date().toISOString(),
  };
}

const runId = await startRun();
let written = 0;
const failures = [];

try {
  const [filingsResult, activityResult, changesResult] = await Promise.all([
    supabase
      .from("filing_events")
      .select("id,company_id,provider,form_type,filed_at,accepted_at,filing_url,title")
      .order("filed_at", { ascending: false })
      .limit(1000),
    supabase
      .from("capital_activity")
      .select("id,company_id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,transaction_date,disclosure_date,position_date,source_url,provider")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("research_changes")
      .select("id,company_id,current_run_id,category,metric_key,label,old_value,new_value,old_text,new_text,direction,materiality,summary,created_at,research_runs!research_changes_current_run_id_fkey(researched_at)")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  for (const result of [filingsResult, activityResult, changesResult]) {
    if (result.error) throw result.error;
  }

  const rows = [
    ...(filingsResult.data ?? []).map(filingRow),
    ...(activityResult.data ?? []).map(activityRow),
    ...(changesResult.data ?? []).map(changeRow),
  ];

  if (rows.length) {
    const { error } = await supabase
      .from("intelligence_events")
      .upsert(rows, { onConflict: "source_kind,source_id", ignoreDuplicates: false });
    if (error) throw error;
    written = rows.length;
  }

  await finishRun(runId, "success", written, "Normalized " + written + " evidence events.", {
    filings: filingsResult.data?.length ?? 0,
    capital_activity: activityResult.data?.length ?? 0,
    research_changes: changesResult.data?.length ?? 0,
  });

  console.log("Normalized intelligence events:", written);
} catch (error) {
  failures.push(error.message);
  await finishRun(runId, "failed", written, error.message, { failures });
  throw error;
}
