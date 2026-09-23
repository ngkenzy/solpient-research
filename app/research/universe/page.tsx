import { ListPageShell } from "@/components/ListPageShell";
import { loadSolpientListsArtifact } from "@/lib/solpient-lists-read-model";

export const dynamic = "force-dynamic";

export default async function UniversePage() {
  const artifact = await loadSolpientListsArtifact();
  return (
    <ListPageShell
      kicker="SOLPIENT 100"
      title="Tracked universe"
      note="Governed Research Candidate Pipeline shortlist. Membership is not a daily screen rewrite."
      rows={artifact?.solpient_100 ?? []}
      empty="No daily list artifact yet. Run npm run local:daily after PRs #98 and #99."
      artifact={artifact}
    />
  );
}
