"use client";
import { useState } from "react";
import Link from "next/link";
import { encodeBid, fakeOrchardUa, hasOrchardReceiver, newNonce } from "@obscura/core";
import type { AppState } from "@/lib/view";
import { zec } from "@/lib/view";
import { downloadKey, newKey, saveKey, type StoredKey } from "@/lib/keys";
import { PayDialog, type PaymentSpec } from "./PayDialog";
import { useAppState } from "./useAppState";

export function AuctionPanel({ initial }: { initial: AppState }) {
  const s = useAppState(initial);
  const a = s.auction;
  const [bidding, setBidding] = useState(false);

  if (!a) {
    return (
      <section className="stack">
        <h1>No auction right now.</h1>
        <p className="muted">When voting closes, the winning piece goes to a sealed-bid auction here.</p>
        <Link className="btn" href="/">
          See the live round
        </Link>
      </section>
    );
  }

  const open = a.status === "OPEN" && s.tip <= a.closeHeight;
  return (
    <section className="two">
      <img src={a.image} alt={a.title} style={{ borderRadius: 14, border: "1px solid var(--line)" }} />
      <div className="stack">
        <span className="pill">
          Auction {a.id} · piece {a.roundId}-{a.candidateId}
        </span>
        <h1>{a.title}</h1>
        <p className="muted">{a.concept}</p>
        <div className="stats">
          <div className="panel">
            <div className="muted small">Reserve</div>
            <div className="stat">{zec(a.reserveZat)}</div>
          </div>
          <div className="panel">
            <div className="muted small">{open ? "Blocks left" : "Sold for"}</div>
            <div className="stat">{open ? Math.max(0, a.closeHeight - s.tip) : a.priceZat != null ? zec(a.priceZat) : "—"}</div>
          </div>
          <div className="panel">
            <div className="muted small">Sealed bids</div>
            <div className="stat">{open ? (a.bidsReceived ?? 0) : (a.validBidCount ?? "—")}</div>
          </div>
        </div>
        {open ? (
          <>
            <p className="small">
              <b>First-price sealed bid.</b> Send your full bid as a shielded payment. Bids are hidden from everyone else; the highest bid wins and pays
              what it bid. Every other bid is refunded automatically, minus a small network fee.
            </p>
            <button className="primary" onClick={() => setBidding(true)}>
              Place a sealed bid
            </button>
          </>
        ) : a.status === "OPEN" ? (
          <p className="muted">Bidding closed. Clearing…</p>
        ) : a.priceZat != null ? (
          <div className="ok">
            Sold for {zec(a.priceZat)} ZEC to an anonymous collector. Refunds {a.status === "SETTLED" ? "have been sent" : "are being sent"}.{" "}
            <Link href="/collect">Won it? Collect it here.</Link>
          </div>
        ) : (
          <p className="muted">No bid met the reserve. The piece stays in the artist's collection; all bids are refunded.</p>
        )}
      </div>
      {bidding && <BidDialog state={s} onClose={() => setBidding(false)} />}
    </section>
  );
}

function BidDialog({ state, onClose }: { state: AppState; onClose: () => void }) {
  const a = state.auction!;
  const [amount, setAmount] = useState(String(a.reserveZat / 1e8));
  const [refundUa, setRefundUa] = useState("");
  const [key, setKey] = useState<StoredKey | null>(null);
  const [spec, setSpec] = useState<PaymentSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepare = () => {
    const zat = Math.round(Number(amount) * 1e8);
    if (!Number.isFinite(zat) || zat < a.reserveZat) return setError(`Bids below the reserve (${zec(a.reserveZat, 8)} ZEC) are refunded and can't win.`);
    const ua = refundUa.trim();
    if (!hasOrchardReceiver(ua, state.network)) return setError(`Refund address must be a ${state.network} Unified Address with an Orchard receiver.`);
    const k = newKey("bidder", a.id, `${a.id} “${a.title}” bid ${zec(zat)} ZEC`);
    saveKey(k);
    downloadKey(k); // the claim key is the only proof of winning: make the backup automatic
    setKey(k);
    setSpec({ title: `Sealed bid on “${a.title}”`, address: a.address, amountZat: zat, memo: encodeBid({ auctionId: a.id, claimPubkey: k.publicKey, refundUa: ua }), label: `Obscura ${a.id} bid` });
  };

  if (spec)
    return (
      <PayDialog spec={spec} mock={state.mock} onClose={onClose}>
        {key && (
          <div className="ok">
            Your claim key was saved in this browser and downloaded. If you win, it's the only way to collect the piece.{" "}
            <button onClick={() => downloadKey(key)}>Download again</button>
          </div>
        )}
      </PayDialog>
    );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
        <h2>Place a sealed bid</h2>
        <div>
          <label>Bid (ZEC) — sent in full now, refunded if you don't win</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label>Your refund address (shielded Unified Address)</label>
          <input value={refundUa} onChange={(e) => setRefundUa(e.target.value)} placeholder={state.network === "mainnet" ? "u1…" : "utest1…"} />
          {state.mock && (
            <button style={{ marginTop: 6 }} onClick={() => setRefundUa(fakeOrchardUa(newNonce(), state.network))}>
              Use a demo address
            </button>
          )}
          <p className="muted small" style={{ marginTop: 6 }}>
            Tip: use a fresh address from your wallet so this refund can't be linked to anything else.
          </p>
        </div>
        {error && <p className="err">{error}</p>}
        <div className="row">
          <button className="primary" onClick={prepare}>
            Create payment request
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
