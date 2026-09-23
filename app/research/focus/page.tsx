import { ListPageShell } from "@/components/ListPageShell";
import { loadSolpientListsArtifact } from "@/lib/solpient-lists-read-model";

export const dynamic = "force-dynamic";

export default async function FocusPage() {
  const artifact = await loadSolpientListsArtifact();
  return (
    <ListPageShell
      kicker="SOLPIENT 5"
      title="Focus list"
      note="Highest Phase 3 ranked Solpient 100 names that are Decision Ready. Fail closed."
      rows={artifact?.solpient_5 ?? []}
      empty="No Decision Ready names in the current Solpient 100."
      artifact={artifact}
    />
  );
}
