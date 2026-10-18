import { CollectPanel } from "@/components/CollectPanel";
import { ctx } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function Collect() {
  const { store } = ctx();
  const auctions = store
    .listAuctions()
    .filter((a) => a.winnerClaimPubkey)
    .map((a) => ({ id: a.id, roundId: a.roundId, candidateId: a.candidateId, claimed: !!store.getClaim(a.id) }));
  const rounds = store
    .listRounds()
    .filter((r) => r.tally)
    .map((r) => ({ id: r.id, winner: r.winner }));
  return <CollectPanel auctions={auctions} rounds={rounds} />;
}
