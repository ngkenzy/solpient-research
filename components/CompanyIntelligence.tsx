import { getCompanyIntelligence } from "@/lib/market-intelligence";

function compact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);
}

function integer(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function date(value: string) {
  return new Date(value + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function CompanyIntelligence({ ticker }: { ticker: string }) {
  const data = getCompanyIntelligence(ticker);
  if (!data) return null;

  return (
    <section className="intelligenceSection" id="intelligence">
      <div className="intelligenceHeading">
        <div>
          <span className="panelKicker">OWNERSHIP & DISCLOSURES</span>
          <h2>Smart money, political disclosures & insiders</h2>
          <p>
            Reported activity is evidence, not a recommendation. Disclosure dates and transaction
            dates are kept separate.
          </p>
        </div>
        <small>Updated {new Date(data.updatedAt).toLocaleDateString("en-US")}</small>
      </div>

      <div className="intelligenceGrid">
        <article className="intelligenceCard">
          <div className="intelligenceCardHeader">
            <div>
              <span>SMART MONEY</span>
              <h3>Notable disclosed holders</h3>
            </div>
            <strong>{data.smartMoney.length}</strong>
          </div>

          <div className="intelligenceList">
            {data.smartMoney.map((holding) => (
              <a
                className="intelligenceRow"
                href={holding.sourceUrl}
                target="_blank"
                rel="noreferrer"
                key={holding.manager + "-" + holding.reportDate}
              >
                <div className="intelligencePrimary">
                  <strong>{holding.investor ?? holding.manager}</strong>
                  <span>{holding.manager}</span>
                </div>
                <div className="intelligenceNumeric">
                  <strong>{integer(holding.shares)} sh</strong>
                  <span>{compact(holding.value)}</span>
                </div>
                <div
                  className={
                    "activityBadge " +
                    (holding.changePct == null
                      ? "neutral"
                      : holding.changePct >= 0
                        ? "positive"
                        : "negative")
                  }
                >
                  {holding.changePct == null
                    ? "Reported"
                    : (holding.changePct >= 0 ? "+" : "") + holding.changePct.toFixed(0) + "%"}
                </div>
              </a>
            ))}
          </div>

          <div className="intelligenceNote">
            <span>As of {date(data.smartMoney[0]?.reportDate ?? "2026-06-30")}</span>
            <p>{data.notes.smartMoney}</p>
          </div>
        </article>

        <article className="intelligenceCard">
          <div className="intelligenceCardHeader">
            <div>
              <span>POLITICAL DISCLOSURES</span>
              <h3>Recently disclosed trades</h3>
            </div>
            <strong>{data.congress.length}</strong>
          </div>

          <div className="intelligenceList">
            {data.congress.map((trade, index) => (
              <a
                className="intelligenceRow congressRow"
                href={trade.sourceUrl}
                target="_blank"
                rel="noreferrer"
                key={trade.politician + "-" + trade.tradeDate + "-" + index}
              >
                <div className="intelligencePrimary">
                  <strong>{trade.politician}</strong>
                  <span>{trade.chamber} · {trade.partyState}</span>
                </div>
                <div className="intelligenceNumeric">
                  <strong>{trade.amountRange}</strong>
                  <span>Traded {date(trade.tradeDate)}</span>
                </div>
                <div className={"activityBadge " + (trade.action === "Purchase" ? "positive" : "negative")}>
                  {trade.action}
                </div>
                <small className="filingDate">Filed {date(trade.filingDate)}</small>
              </a>
            ))}
          </div>

          <div className="intelligenceNote">
            <p>{data.notes.congress}</p>
          </div>
        </article>

        <article className="intelligenceCard">
          <div className="intelligenceCardHeader">
            <div>
              <span>INSIDER ACTIVITY</span>
              <h3>Open-market activity</h3>
            </div>
            <strong>{data.insiders.length}</strong>
          </div>

          <div className="intelligenceList">
            {data.insiders.map((trade) => (
              <a
                className="intelligenceRow"
                href={trade.sourceUrl}
                target="_blank"
                rel="noreferrer"
                key={trade.insider + "-" + trade.tradeDate}
              >
                <div className="intelligencePrimary">
                  <strong>{trade.insider}</strong>
                  <span>{trade.title ?? "Insider"}</span>
                </div>
                <div className="intelligenceNumeric">
                  <strong>{integer(trade.shares)} sh · {"$" + trade.price.toFixed(2)}</strong>
                  <span>{compact(trade.value)} · {date(trade.tradeDate)}</span>
                </div>
                <div className={"activityBadge " + (trade.action === "Buy" ? "positive" : "negative")}>
                  {trade.action}
                </div>
              </a>
            ))}
          </div>

          <div className="intelligenceNote">
            <p>{data.notes.insiders}</p>
          </div>
        </article>
      </div>
    </section>
  );
}
