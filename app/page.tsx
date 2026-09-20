const pillars = [
  ["Discover", "Surface companies worthy of deeper fundamental research."],
  ["Research", "Store structured financial analysis, valuation, risks, catalysts, and sources."],
  ["Remember", "Preserve every research version instead of overwriting history."],
  ["Monitor", "Show what changed in the thesis, valuation, and fundamentals over time."],
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">SOLPIENT RESEARCH</div>
        <h1>See clearly. Invest deliberately.</h1>
        <p className="lede">
          A point-in-time fundamental research system that remembers what we believed,
          what changed, and what happened afterward.
        </p>
      </section>

      <section className="grid">
        {pillars.map(([title, body]) => (
          <article key={title} className="card">
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="status">
        <div>
          <span className="statusLabel">BUILD STATUS</span>
          <strong>Foundation initialized</strong>
        </div>
        <p>Next milestone: ADBE Research Version 1 → database → company page.</p>
      </section>
    </main>
  );
}
