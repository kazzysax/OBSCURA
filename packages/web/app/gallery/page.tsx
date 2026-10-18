import { ctx, imageUrl } from "@/lib/server";
import { zec } from "@/lib/view";

export const dynamic = "force-dynamic";

export default function Gallery() {
  const { store } = ctx();
  const rounds = store.listRounds();
  if (!rounds.length) return <p className="muted">Nothing here yet.</p>;
  return (
    <div className="stack">
      <h1>Gallery</h1>
      <p className="muted">Every round, every piece. Winners went to auction; prices are public, buyers are not.</p>
      {rounds.map((r) => {
        const auction = store.auctionForRound(r.id);
        const claimed = auction ? store.getClaim(auction.id) : null;
        return (
          <section key={r.id} style={{ marginTop: 28 }}>
            <div className="spread">
              <h2>
                {r.id} · {r.theme}
              </h2>
              <span className="muted small">
                {r.status.replace("_", " ").toLowerCase()} · {r.tally ? `${r.tally.votes.length} votes` : "voting"}
                {auction?.priceZat != null && ` · sold for ${zec(auction.priceZat)} ZEC (${auction.validBidCount} bids)`}
                {claimed && " · collected"}
              </span>
            </div>
            <div className="grid">
              {store.candidates(r.id).map((c) => {
                const total = r.tally?.totals.find((t) => t.candidateId === c.candidateId);
                return (
                  <article key={c.candidateId} className={`card${r.winner === c.candidateId ? " winner" : ""}`}>
                    <img className="art" src={imageUrl(c.imageFile)} alt={c.title} loading="lazy" />
                    <div className="body">
                      <h3>{c.title}</h3>
                      <span className="muted small">
                        {total ? `${zec(total.totalZat)} ZEC · ${total.votes} votes` : "open"}
                        {r.winner === c.candidateId && " · winner"}
                      </span>
                      <code className="small muted">sha256 {c.imageSha256.slice(0, 16)}…</code>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
