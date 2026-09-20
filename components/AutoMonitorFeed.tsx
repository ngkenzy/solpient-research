import feed from "@/data/monitor/sec-events.json";
import provider from "@/data/monitor/provider-status.json";

type MonitorEvent = {
  id: string;
  ticker: string;
  company_name: string;
  form: string;
  filing_date?: string | null;
  detected_at: string;
  category: string;
  severity: string;
  queue: string;
  label: string;
  reason: string;
  source_url?: string | null;
  manager_name?: string;
  investor_name?: string;
};

type RawMonitorEvent = {
  id?: string;
  ticker?: string;
  company_name?: string;
  company?: string;
  form?: string;
  event_type?: string;
  filing_date?: string | null;
  detected_at?: string;
  category?: string;
  severity?: string;
  materiality?: string;
  queue?: string;
  label?: string;
  reason?: string;
  note?: string;
  source_url?: string | null;
  manager_name?: string;
  investor_name?: string;
  insider?: string;
  research_review_needed?: boolean;
  accession_number?: string;
};

function normalizeEvent(event: RawMonitorEvent, index: number, generatedAt?: string | null): MonitorEvent {
  const eventType = event.event_type ?? event.label ?? "Public disclosure";
  const form =
    event.form ??
    (eventType.toLowerCase().includes("form 4") ? "4" : eventType.match(/\b(10-[KQ]|8-K|13F)\b/i)?.[1] ?? "Disclosure");

  const category =
    event.category ??
    (eventType.toLowerCase().includes("insider") || form === "4"
      ? "insider"
      : form.toUpperCase().includes("13F")
        ? "ownership"
        : "filing");

  const queue =
    event.queue ??
    (event.research_review_needed
      ? "research_review"
      : category === "ownership" || category === "insider"
        ? "ownership_review"
        : "monitor");

  const severity =
    event.severity ??
    (event.materiality === "high"
      ? "high"
      : event.materiality === "review"
        ? "medium"
        : "low");

  return {
    id:
      event.id ??
      event.accession_number ??
      [event.ticker ?? "event", event.filing_date ?? generatedAt ?? "pending", index].join("-"),
    ticker: event.ticker ?? "—",
    company_name: event.company_name ?? event.company ?? event.ticker ?? "Company",
    form,
    filing_date: event.filing_date ?? null,
    detected_at: event.detected_at ?? generatedAt ?? new Date(0).toISOString(),
    category,
    severity,
    queue,
    label: event.label ?? eventType,
    reason: event.reason ?? event.note ?? "New public disclosure detected for review.",
    source_url: event.source_url ?? null,
    manager_name: event.manager_name,
    investor_name: event.investor_name ?? event.insider,
  };
}

function formatDate(value?: string | null) {
  if (!value) return "Date pending";
  return new Date(value + (value.includes("T") ? "" : "T00:00:00Z")).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function queueLabel(queue: string) {
  if (queue === "research_review") return "Research review";
  if (queue === "ownership_review") return "Ownership review";
  return "Monitor";
}

export function AutoMonitorFeed() {
  const rawFeed = feed as unknown as {
    generated_at?: string | null;
    events?: RawMonitorEvent[];
  };
  const generatedAt = rawFeed.generated_at;
  const events = (rawFeed.events ?? [])
    .map((event, index) => normalizeEvent(event, index, generatedAt))
    .slice(0, 20);

  return (
    <section className="monitorFeedSection">
      <div className="monitorFeedHeader">
        <div>
          <span className="panelKicker">SOLPIENT AUTO-MONITOR</span>
          <h2>Live filing queue</h2>
          <p>
            Public disclosure sources are checked automatically every four hours. Material filings
            enter a review queue instead of silently overwriting published research.
          </p>
        </div>
        <div className="monitorStatus" title={provider.message}>
          <i />
          <span>{provider.active ? "Monitor active" : "Monitor paused"}</span>
          <small>
            {provider.active
              ? "Every " + provider.cadence_hours + " hours · tracked research universe"
              : "Provider unavailable"}
          </small>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="monitorEmpty">
          <strong>No new filings since the monitor baseline.</strong>
          <p>
            SOLPIENT watches tracked research companies for material filings, insider activity,
            ownership disclosures, and other public evidence.
          </p>
        </div>
      ) : (
        <div className="monitorEventList">
          {events.map((event) => (
            <article className={"monitorEvent " + event.severity} key={event.id}>
              <div className="monitorEventTicker">{event.ticker}</div>
              <div className="monitorEventBody">
                <div>
                  <strong>{event.label}</strong>
                  <span>{event.company_name} · Form {event.form}</span>
                </div>
                <p>{event.reason}</p>
                <div className="monitorEventMeta">
                  <span>{formatDate(event.filing_date)}</span>
                  <span>{queueLabel(event.queue)}</span>
                  {event.investor_name ? <span>{event.investor_name}</span> : null}
                </div>
              </div>
              {event.source_url ? (
                <a href={event.source_url} target="_blank" rel="noreferrer" aria-label={"Open " + event.label}>
                  ↗
                </a>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
