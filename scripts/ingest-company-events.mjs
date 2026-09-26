// V1 real-world event ingestion worker.
//
// Deterministic pipeline: SEC 8-K filings (+ share-count derivations) ->
// classified taxonomy events -> company_change_events -> Stage A materiality
// assessment (via the service-role-only public wrapper). No LLM anywhere in
// this path; Stage B (user materiality) refreshes lazily when What Matters is
// read.
//
// Usage:
//   node scripts/ingest-company-events.mjs [--ticker ADBE] [--limit 25] [--dry-run]
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
// Loopback guard: refuses to run against a non-local Supabase URL unless
// SOLPIENT_ALLOW_REMOTE_DB=1 is set. Money stays local; research V1 ingestion
// is a local-stack operation until the Group A production gate passes.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  TAXONOMY_VERSION,
  AFFECTED_FACT_PATTERNS,
  extractEightKItems,
  classifyEightKItem,
  detectShareCountEvent,
} from "../lib/event-detectors.mjs";

const root = process.cwd();
const companiesPath = path.join(root, "data/monitor/companies.json");

const url = process.env.SUPABASE_URL?.trim();
const secret =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !secret) throw new Error("Missing SUPABASE_URL and server secret.");

const isLoopback = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
if (!isLoopback && process.env.SOLPIENT_ALLOW_REMOTE_DB !== "1") {
  throw new Error(
    "Refusing to ingest events against a non-local Supabase URL. " +
      "Set SOLPIENT_ALLOW_REMOTE_DB=1 to override."
  );
}

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const [k, v] = process.argv[i].split("=");
  args.set(k.replace(/^--/, ""), v ?? true);
}
const onlyTicker = args.has("ticker") ? String(args.get("ticker")).toUpperCase() : null;
const limit = Math.max(1, Number(args.get("limit") ?? 25));
const dryRun = args.has("dry-run");

const secContact = process.env.SEC_CONTACT || "ngkenzy@users.noreply.github.com";
const userAgent = process.env.SEC_USER_AGENT || "SOLPIENT Research " + secContact;

const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function secText(docUrl) {
  const response = await fetch(docUrl, {
    headers: { "User-Agent": userAgent, From: secContact, "Accept-Encoding": "gzip, deflate", Accept: "text/html,*/*" },
  });
  if (!response.ok) throw new Error("SEC document fetch failed " + response.status);
  try {
    const html = await response.text();
    return html
      .slice(0, 400_000)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  } finally {
    await sleep(160);
  }
}

// 8-K items whose classification needs keyword evidence from the filing text.
// All other items classify deterministically from the item code alone.
const TEXT_ITEMS = new Set(["2.02", "5.02", "7.01", "8.01"]);

function textUnavailableClassification(item) {
  return {
    category: "business",
    subtype: "other event",
    materiality: "notable",
    decision_impact: "monitor",
    direction: "new",
    confidence: 50,
    label: `8-K Item ${item} — filing text unavailable`,
    summary:
      `Item ${item} needs filing-text review for a thesis-relevant classification, ` +
      `but the filing document could not be fetched during this run. Surfaced for review, not dismissed.`,
  };
}

async function resolveAffectedFact(companyId, category) {
  const patterns = AFFECTED_FACT_PATTERNS[category] ?? [];
  if (!patterns.length) return null;
  const { data, error } = await sb
    .from("normalized_facts")
    .select("id,metric_key,known_at")
    .eq("company_id", companyId)
    .order("known_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  for (const row of data ?? []) {
    const metric = String(row.metric_key ?? "").toLowerCase();
    if (patterns.some((p) => metric.includes(p.replaceAll("%", "")))) return row.id;
  }
  return null;
}

async function assessEvent(eventId) {
  if (dryRun) return;
  const { error } = await sb.rpc("assess_company_event_materiality_v1", {
    p_company_change_event_id: eventId,
  });
  if (error) throw error;
}

const companiesFile = JSON.parse(await fs.readFile(companiesPath, "utf8"));
const cikByTicker = new Map(
  (Array.isArray(companiesFile) ? companiesFile : []).map((c) => [
    String(c.ticker ?? "").toUpperCase(),
    String(c.cik ?? "").replace(/\D/g, ""),
  ])
);

const { data: companies, error: companyError } = await sb
  .from("companies")
  .select("id,ticker,company_name")
  .order("ticker");
if (companyError) throw companyError;

const summary = [];
const now = new Date().toISOString();

for (const company of companies ?? []) {
  const ticker = String(company.ticker ?? "").toUpperCase();
  if (onlyTicker && ticker !== onlyTicker) continue;

  // Recent 8-K filings for this company, newest first.
  const { data: filings, error: filingError } = await sb
    .from("filing_events")
    .select("id,form_type,filed_at,accession_number,filing_url,raw_payload")
    .eq("company_id", company.id)
    .eq("provider", "sec-submissions-monitor")
    .in("form_type", ["8-K", "8-K/A"])
    .order("filed_at", { ascending: false })
    .limit(limit);
  if (filingError) throw filingError;

  const { data: existing, error: existingError } = await sb
    .from("company_change_events")
    .select("event_key")
    .eq("company_id", company.id)
    .like("event_key", "8k:%");
  if (existingError) throw existingError;
  const seenKeys = new Set((existing ?? []).map((r) => r.event_key));

  let inserted = 0;
  let assessed = 0;
  const filingSummaries = [];

  for (const filing of filings ?? []) {
    const accession = filing.accession_number;
    let items = filing.raw_payload?.items ?? null;
    if (!Array.isArray(items)) items = null;

    let text = null;
    let textUnavailable = false;
    const needsText = (items ?? []).some((i) => TEXT_ITEMS.has(String(i))) || items === null;
    if (needsText && filing.filing_url) {
      try {
        text = await secText(filing.filing_url);
      } catch (error) {
        textUnavailable = true;
        console.warn(`[${ticker}] filing text fetch failed for ${accession}: ${error.message}`);
      }
    } else if (needsText) {
      // No filing URL to fetch: never dismiss a text-dependent item as
      // not_material — surface it for review instead.
      textUnavailable = true;
    }

    let classifications = [];
    if (items && items.length) {
      for (const rawItem of items) {
        const item = String(rawItem).trim();
        const eventKey = `8k:${accession}:${item}`;
        if (seenKeys.has(eventKey)) continue;
        let classification;
        if (TEXT_ITEMS.has(item) && text === null) {
          classification = textUnavailable
            ? textUnavailableClassification(item)
            : classifyEightKItem(item, "");
        } else {
          classification = classifyEightKItem(item, text ?? "");
        }
        if (classification) classifications.push({ item, eventKey, classification });
      }
    } else {
      const found = text ? extractEightKItems(text) : [];
      for (const item of found) {
        const eventKey = `8k:${accession}:${item}`;
        if (seenKeys.has(eventKey)) continue;
        const classification = classifyEightKItem(item, text ?? "");
        if (classification) classifications.push({ item, eventKey, classification });
      }
    }

    const rows = [];
    for (const { item, eventKey, classification } of classifications) {
      const affectedFactId = await resolveAffectedFact(company.id, classification.category);
      rows.push({
        company_id: company.id,
        occurred_at: filing.filed_at,
        label: classification.label,
        summary: classification.summary,
        category: classification.category,
        metric_key: `event.8k.${item.replace(/\./g, "_")}`,
        direction: classification.direction,
        materiality: classification.materiality,
        decision_impact: classification.decision_impact,
        confidence: classification.confidence,
        knowledge_time: filing.filed_at,
        disclosure_time: now,
        affected_fact_id: affectedFactId,
        event_key: eventKey,
        event_source: "sec-8k-detector-v1",
        event_taxonomy: TAXONOMY_VERSION,
        evidence_payload: {
          label: classification.label,
          summary: classification.summary,
          confidence: classification.confidence,
          event_key: eventKey,
          filing: {
            form_type: filing.form_type,
            accession_number: accession,
            filed_at: filing.filed_at,
            filing_url: filing.filing_url,
            item,
            ...(classification.subtype ? { subtype: classification.subtype } : {}),
            ...(classification.guidance_direction ? { guidance_direction: classification.guidance_direction } : {}),
            ...(classification.management_role ? { management_role: classification.management_role } : {}),
            ...(classification.management_action ? { management_action: classification.management_action } : {}),
          },
        },
      });
      seenKeys.add(eventKey);
    }

    if (rows.length && !dryRun) {
      const { data: stored, error: insertError } = await sb
        .from("company_change_events")
        .insert(rows)
        .select("id");
      if (insertError) throw insertError;
      inserted += stored?.length ?? 0;
      for (const row of stored ?? []) {
        await assessEvent(row.id);
        assessed += 1;
      }
    } else if (rows.length) {
      inserted += rows.length;
    }
    if (classifications.length) {
      filingSummaries.push({
        accession_number: accession,
        items: classifications.map((c) => ({ item: c.item, category: c.classification.category, materiality: c.classification.materiality })),
      });
    }
  }

  // Share-count derivation from SEC companyfacts (capital allocation).
  let shareEvent = null;
  const cik = cikByTicker.get(ticker);
  if (cik && !onlyTicker) {
    try {
      const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`;
      const response = await fetch(factsUrl, {
        headers: { "User-Agent": userAgent, From: secContact, "Accept-Encoding": "gzip, deflate", Accept: "application/json" },
      });
      if (response.ok) {
        const facts = await response.json();
        const units = facts?.facts?.["us-gaap"]?.["SharesOutstanding"]?.units?.["shares"] ?? [];
        const points = units
          .filter((p) => p?.end && Number.isFinite(Number(p.val)) && ["10-K", "10-Q"].includes(p.form))
          .sort((a, b) => String(b.end).localeCompare(String(a.end)));
        const [latest, previous] = points;
        if (latest && previous && latest.end !== previous.end) {
          const detection = detectShareCountEvent({
            prevShares: Number(previous.val),
            currShares: Number(latest.val),
            periodEnd: latest.end,
          });
          if (detection) {
            const { data: seenShare, error: seenError } = await sb
              .from("company_change_events")
              .select("id")
              .eq("company_id", company.id)
              .eq("event_key", detection.event_key)
              .maybeSingle();
            if (seenError) throw seenError;
            if (!seenShare) {
              const affectedFactId = await resolveAffectedFact(company.id, detection.category);
              const row = {
                company_id: company.id,
                occurred_at: latest.end,
                label: detection.label,
                summary: detection.summary,
                category: detection.category,
                metric_key: detection.metric_key,
                direction: detection.direction,
                materiality: detection.materiality,
                decision_impact: detection.decision_impact,
                confidence: detection.confidence,
                knowledge_time: latest.end,
                disclosure_time: now,
                affected_fact_id: affectedFactId,
                event_key: detection.event_key,
                event_source: "sec-companyfacts-detector-v1",
                event_taxonomy: TAXONOMY_VERSION,
                evidence_payload: {
                  label: detection.label,
                  summary: detection.summary,
                  confidence: detection.confidence,
                  event_key: detection.event_key,
                  delta_percent: detection.delta_percent,
                  period_end: latest.end,
                  previous_period_end: previous.end,
                },
              };
              if (!dryRun) {
                const { data: stored, error: insertError } = await sb
                  .from("company_change_events")
                  .insert(row)
                  .select("id")
                  .single();
                if (insertError) throw insertError;
                await assessEvent(stored.id);
                assessed += 1;
              }
              inserted += 1;
              shareEvent = { event_key: detection.event_key, subtype: detection.subtype, materiality: detection.materiality };
            }
          }
        }
      }
      await sleep(160);
    } catch (error) {
      console.warn(`[${ticker}] companyfacts check failed: ${error.message}`);
    }
  }

  summary.push({
    ticker,
    filings_seen: (filings ?? []).length,
    events_inserted: inserted,
    events_assessed: assessed,
    filings: filingSummaries,
    share_count_event: shareEvent,
  });
}

console.log(JSON.stringify({
  ingested_at: now,
  dry_run: dryRun,
  detector_taxonomy: TAXONOMY_VERSION,
  summary,
}, null, 2));
