import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ResearchIndex() {
  const supabase = getSupabase();

  if (!supabase) {
    return (
      <main>
        <Link className="backLink" href="/">← SOLPIENT Research</Link>
        <section className="hero compactHero">
          <div className="eyebrow">RESEARCH</div>
          <h1>Company research</h1>
          <p className="lede">Supabase environment variables are not configured yet.</p>
        </section>
      </main>
    );
  }

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id,ticker,company_name,sector,industry")
    .order("ticker");

  return (
    <main>
      <Link className="backLink" href="/">← SOLPIENT Research</Link>

      <section className="hero compactHero">
        <div className="eyebrow">RESEARCH</div>
        <h1>Company research</h1>
        <p className="lede">
          Every published analysis is versioned. New research adds history instead of rewriting it.
        </p>
      </section>

      {error ? (
        <section className="emptyState">
          <strong>Unable to load research.</strong>
          <p>{error.message}</p>
        </section>
      ) : companies && companies.length > 0 ? (
        <section className="companyList">
          {companies.map((company) => (
            <Link key={company.id} className="companyRow" href={`/research/${company.ticker}`}>
              <div>
                <strong>{company.ticker}</strong>
                <span>{company.company_name}</span>
              </div>
              <div className="companyMeta">
                <span>{company.sector ?? "Sector pending"}</span>
                <span>View research →</span>
              </div>
            </Link>
          ))}
        </section>
      ) : (
        <section className="emptyState">
          <strong>No companies published yet.</strong>
          <p>Our first target is ADBE Research Version 1.</p>
        </section>
      )}
    </main>
  );
}
