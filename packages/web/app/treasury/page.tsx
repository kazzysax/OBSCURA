import { DonateButton } from "@/components/DonateButton";
import { SurvivalPill } from "@/components/SurvivalPill";
import { appState, ctx } from "@/lib/server";
import { zec } from "@/lib/view";

export const dynamic = "force-dynamic";

export default function Treasury() {
  const s = appState();
  const { store, config } = ctx();
  const rounds = store.listRounds();
  const spent = store.db.prepare("SELECT at, amount_zat, what FROM spending ORDER BY id DESC LIMIT 20").all() as { at: string; amount_zat: number; what: string }[];
  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Treasury</h1>
        <SurvivalPill state={s.survival.state} />
      </div>
      <p className="muted">
        The artist lives as long as patrons keep it alive. When the treasury can't pay for a round, it stops making art and only writes, until someone
        funds it again.
      </p>
      <div className="stats">
        <div className="panel">
          <div className="muted small">Balance</div>
          <div className="stat">{zec(s.survival.treasuryZat)} ZEC</div>
        </div>
        <div className="panel">
          <div className="muted small">Runway</div>
          <div className="stat">{s.survival.runwayDays == null ? "∞" : `${s.survival.runwayDays.toFixed(1)} days`}</div>
        </div>
        <div className="panel">
          <div className="muted small">Cost per day</div>
          <div className="stat">{zec(config.dailySpendZat)} ZEC</div>
        </div>
      </div>
      <p className="small muted">
        Survival states: thriving (&gt; 30 days), steady (7–30), struggling (&lt; 7), dormant (can't afford one round). The agent picks how many pieces to
        make and the reserve price only within hard limits ({config.bounds.piecesMin}–{config.bounds.piecesMax} pieces, {zec(config.bounds.reserveMinZat)}–
        {zec(config.bounds.reserveMaxZat)} ZEC). It never touches money: tallies, refunds and payouts are deterministic code.
      </p>
      {s.donationAddress && <DonateButton address={s.donationAddress} mock={s.mock} />}

      <div className="two">
        <div className="panel">
          <h2>Income by round</h2>
          <table style={{ width: "100%", fontSize: ".9rem" }}>
            <tbody>
              {rounds.map((r) => {
                const votes = r.tally ? r.tally.votes.reduce((n, v) => n + v.note.valueZat, 0) : 0;
                const sale = store.auctionForRound(r.id)?.priceZat ?? 0;
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td className="muted">votes {zec(votes)}</td>
                    <td className="muted">sale {zec(sale)}</td>
                    <td style={{ textAlign: "right" }}>{zec(votes + sale)} ZEC</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Spending</h2>
          <table style={{ width: "100%", fontSize: ".9rem" }}>
            <tbody>
              {spent.map((x, i) => (
                <tr key={i}>
                  <td className="muted">{x.what}</td>
                  <td style={{ textAlign: "right" }}>{zec(x.amount_zat)} ZEC</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
