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
  const events = ((feed as { events?: MonitorEvent[] }).events ?? []).slice(0, 20);
  const generatedAt = (feed as { generated_at?: string | null }).generated_at;

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
              ? "Every " + provider.cadence_hours + " hours · ADBE + DECK"
              : "Provider unavailable"}
          </small>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="monitorEmpty">
          <strong>No new filings since the monitor baseline.</strong>
          <p>
            SOLPIENT is watching ADBE and DECK for 10-K, 10-Q, 8-K, insider Form 4,
            notable-manager 13F filings, and political transaction disclosures.
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
