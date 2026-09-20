import { getSupabase } from "@/lib/supabase";

function compact(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}

function integer(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value?: string | null) {
  if (!value) return "Date unavailable";
  return new Date(value + (value.includes("T") ? "" : "T00:00:00Z")).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function CompanyIntelligence({ ticker }: { ticker: string }) {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: company } = await supabase
    .from("companies")
    .select("id,ticker")
    .eq("ticker", ticker.toUpperCase())
    .maybeSingle();

  if (!company) return null;

  const { data, error } = await supabase
    .from("capital_activity")
    .select("id,activity_type,actor_name,actor_detail,action,shares,price,value,change_pct,amount_range,transaction_date,disclosure_date,position_date,source_url,provider,verified_at,created_at")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return null;
  const rows = data ?? [];

  const { data: providerHealth } = await supabase
    .from("capital_provider_health")
    .select("provider,feed_type,status,last_success_at,last_verified_at,last_error,metadata")
    .eq("feed_type", "all")
    .order("updated_at", { ascending: false });

  const institutionalAll = rows
    .filter((row) => row.activity_type === "institutional")
    .sort((a, b) => String(b.position_date ?? b.disclosure_date ?? b.created_at).localeCompare(String(a.position_date ?? a.disclosure_date ?? a.created_at)));
  const institutional = institutionalAll.filter((row, index, array) =>
    array.findIndex((item) => item.actor_name === row.actor_name && item.actor_detail === row.actor_detail) === index
  );
  const political = rows
    .filter((row) => row.activity_type === "political")
    .sort((a, b) => String(b.disclosure_date ?? b.transaction_date ?? b.created_at).localeCompare(String(a.disclosure_date ?? a.transaction_date ?? a.created_at)));
  const insiders = rows
    .filter((row) => row.activity_type === "insider")
    .sort((a, b) => String(b.disclosure_date ?? b.transaction_date ?? b.created_at).localeCompare(String(a.disclosure_date ?? a.transaction_date ?? a.created_at)));

  const latest = rows
    .map((row) => row.disclosure_date ?? row.transaction_date ?? row.position_date ?? row.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const latestVerified = rows
    .map((row) => row.verified_at ?? row.created_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const providers = [...new Set(rows.map((row) => row.provider).filter(Boolean))];
  const providerStatus = (providerHealth ?? [])
    .filter((row) => ["healthy", "degraded", "blocked", "stale"].includes(row.status))
    .slice(0, 4);

  return (
    <section className="intelligenceSection" id="intelligence">
      <div className="intelligenceHeading">
        <div>
          <span className="panelKicker">OWNERSHIP & DISCLOSURES</span>
          <h2>Capital activity around {ticker.toUpperCase()}</h2>
          <p>
            Reported activity is supporting evidence, not a recommendation. Transaction, position,
            and disclosure dates are kept separate when the source provides them.
          </p>
        </div>
        <small>
          {latestVerified ? "Last verified " + date(latestVerified) : "No verified activity loaded"}
          {providers.length ? " · " + providers.join(", ") : ""}
        </small>
      </div>

      {providerStatus.length ? (
        <div className="intelligenceNote">
          <span>Provider health</span>
          <p>
            {providerStatus.map((row) => row.provider + ": " + row.status).join(" · ")}
            {latest ? " · latest ledger date " + date(latest) : ""}
          </p>
        </div>
      ) : null}

      <div className="intelligenceGrid">
        <article className="intelligenceCard">
          <div className="intelligenceCardHeader">
            <div>
              <span>INSTITUTIONAL</span>
              <h3>Notable investors · latest disclosed position</h3>
            </div>
            <strong>{institutional.length}</strong>
          </div>

          <div className="intelligenceList">
            {institutional.length ? institutional.slice(0, 8).map((holding) => {
              const change = asNumber(holding.change_pct);
              return (
                <a
                  className="intelligenceRow"
                  href={holding.source_url ?? "#"}
                  target={holding.source_url ? "_blank" : undefined}
                  rel={holding.source_url ? "noreferrer" : undefined}
                  key={holding.id}
                >
                  <div className="intelligencePrimary">
                    <strong>{holding.actor_name}</strong>
                    <span>{holding.actor_detail ?? "Institutional manager"}</span>
                  </div>
                  <div className="intelligenceNumeric">
                    <strong>{integer(asNumber(holding.shares))} sh</strong>
                    <span>{compact(asNumber(holding.value))}</span>
                  </div>
                  <div className={"activityBadge " + (change == null ? "neutral" : change >= 0 ? "positive" : "negative")}>
                    {change == null ? holding.action : (change >= 0 ? "+" : "") + change.toFixed(0) + "%"}
                  </div>
                </a>
              );
            }) : <div className="intelligenceNote"><p>No institutional activity loaded yet.</p></div>}
          </div>

          <div className="intelligenceNote">
            <span>{institutional[0]?.position_date ? "Position date " + date(institutional[0].position_date) : "Position date unavailable"}</span>
            <p>13F ownership records are delayed quarterly snapshots. Change badges compare the latest disclosed position with the manager’s prior quarter.</p>
          </div>
        </article>

        <article className="intelligenceCard">
          <div className="intelligenceCardHeader">
            <div>
              <span>POLITICAL DISCLOSURES</span>
              <h3>Reported transactions</h3>
            </div>
            <strong>{political.length}</strong>
          </div>

          <div className="intelligenceList">
            {political.length ? political.slice(0, 8).map((trade) => (
              <a
                className="intelligenceRow congressRow"
                href={trade.source_url ?? "#"}
                target={trade.source_url ? "_blank" : undefined}
                rel={trade.source_url ? "noreferrer" : undefined}
                key={trade.id}
              >
                <div className="intelligencePrimary">
                  <strong>{trade.actor_name}</strong>
                  <span>{trade.actor_detail ?? "Public disclosure"}</span>
                </div>
                <div className="intelligenceNumeric">
                  <strong>{trade.amount_range ?? "Range unavailable"}</strong>
                  <span>Traded {date(trade.transaction_date)}</span>
                </div>
                <div className={"activityBadge " + (trade.action === "Purchase" ? "positive" : trade.action === "Sale" ? "negative" : "neutral")}>
                  {trade.action}
                </div>
                <small className="filingDate">Filed {date(trade.disclosure_date)}</small>
              </a>
            )) : <div className="intelligenceNote"><p>No political transaction disclosures loaded yet.</p></div>}
          </div>

          <div className="intelligenceNote">
            <p>Solpient keeps the transaction date separate from the later disclosure date and does not treat the activity as a research conclusion.</p>
          </div>
        </article>

        <article className="intelligenceCard">
          <div className="intelligenceCardHeader">
            <div>
              <span>INSIDER ACTIVITY</span>
              <h3>Reported insider transactions</h3>
            </div>
            <strong>{insiders.length}</strong>
          </div>

          <div className="intelligenceList">
            {insiders.length ? insiders.slice(0, 8).map((trade) => {
              const shares = asNumber(trade.shares);
              const price = asNumber(trade.price);
              return (
                <a
                  className="intelligenceRow"
                  href={trade.source_url ?? "#"}
                  target={trade.source_url ? "_blank" : undefined}
                  rel={trade.source_url ? "noreferrer" : undefined}
                  key={trade.id}
                >
                  <div className="intelligencePrimary">
                    <strong>{trade.actor_name}</strong>
                    <span>{trade.actor_detail ?? "Insider"}</span>
                  </div>
                  <div className="intelligenceNumeric">
                    <strong>{integer(shares)} sh{price != null ? " · $" + price.toFixed(2) : ""}</strong>
                    <span>{compact(asNumber(trade.value))} · {date(trade.transaction_date)}</span>
                  </div>
                  <div className={"activityBadge " + (trade.action === "Buy" ? "positive" : trade.action === "Sell" ? "negative" : "neutral")}>
                    {trade.action}
                  </div>
                </a>
              );
            }) : <div className="intelligenceNote"><p>No insider activity loaded yet.</p></div>}
          </div>

          <div className="intelligenceNote">
            <p>Transaction type is shown as reported by the stored source. It is not interpreted as a buy or sell signal for the stock.</p>
          </div>
        </article>
      </div>
    </section>
  );
}
