import Link from "next/link";
import { SolpientBrand } from "@/components/SolpientBrand";
import { SolpientListTable } from "@/components/SolpientListTable";
import type { SolpientListEntry, SolpientListsArtifact } from "@/lib/solpient-lists-read-model";

export function ListPageShell({
  title,
  kicker,
  note,
  rows,
  empty,
  artifact,
}: {
  title: string;
  kicker: string;
  note: string;
  rows: SolpientListEntry[];
  empty: string;
  artifact: SolpientListsArtifact | null;
}) {
  return (
    <>
      <header className="siteHeader">
        <SolpientBrand />
        <nav>
          <Link href="/research">Research</Link>
          <Link href="/research/focus">Focus 5</Link>
          <Link href="/research/core">Core 20</Link>
          <Link href="/research/universe">Universe 100</Link>
          <Link href="/data-engine">Data Engine</Link>
        </nav>
      </header>
      <main className="rankingShell">
        <span className="panelKicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{note}</p>
        <p>
          Methodology {artifact?.methodology_version ?? "pending"} · {rows.length} names
        </p>
        <SolpientListTable rows={rows} empty={empty} />
        <section className="rankingFootnote">
          <strong>Not a buy list.</strong>
          <p>Decision Ready means evidence is complete enough to compare. It is not a recommendation.</p>
        </section>
      </main>
    </>
  );
}
