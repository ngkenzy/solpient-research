import { ListPageShell } from "@/components/ListPageShell";
import { loadSolpientListsArtifact } from "@/lib/solpient-lists-read-model";

export const dynamic = "force-dynamic";

export default async function CorePage() {
  const artifact = await loadSolpientListsArtifact();
  return (
    <ListPageShell
      kicker="SOLPIENT 20"
      title="Core list"
      note="Highest Phase 3 ranked Solpient 100 names that are Research Ready or Decision Ready. Fail closed."
      rows={artifact?.solpient_20 ?? []}
      empty="No Research Ready or Decision Ready names qualify yet."
      artifact={artifact}
    />
  );
}
