"use client";
import { useEffect, useState } from "react";
import { signMessage, type BadgeCertificate, type ProvenanceCertificate } from "@obscura/core";
import { loadKeys, parseKeyFile, type StoredKey } from "@/lib/keys";

type AuctionRef = { id: string; roundId: string; candidateId: string; claimed: boolean };
type RoundRef = { id: string; winner: string | null };

function saveFile(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? res.statusText);
  return j as T;
}

export function CollectPanel({ auctions, rounds }: { auctions: AuctionRef[]; rounds: RoundRef[] }) {
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<{ certificate: ProvenanceCertificate; image: { mime: string; base64: string; filename: string } } | null>(null);
  const [badge, setBadge] = useState<BadgeCertificate | null>(null);

  useEffect(() => setKeys(loadKeys()), []);

  const importKey = async (file: File | undefined) => {
    if (!file) return;
    const k = parseKeyFile(await file.text());
    if (!k) return setError("That file isn't an Obscura key.");
    setKeys((ks) => [...ks.filter((x) => x.publicKey !== k.publicKey), k]);
    setError(null);
  };

  const collectPiece = async (k: StoredKey) => {
    setBusy(true);
    setError(null);
    try {
      const ch = await post<{ challenge: string; nonce: string }>("/api/challenge", { kind: "claim", id: k.target });
      const res = await post<NonNullable<typeof claim>>("/api/claim", { auctionId: k.target, nonce: ch.nonce, signature: signMessage(ch.challenge, k.privateKey) });
      setClaim(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const collectBadge = async (k: StoredKey) => {
    setBusy(true);
    setError(null);
    try {
      const ch = await post<{ challenge: string; nonce: string }>("/api/challenge", { kind: "badge", id: k.target });
      const res = await post<{ badge: BadgeCertificate }>("/api/badge", {
        roundId: k.target,
        patronPubkey: k.publicKey,
        nonce: ch.nonce,
        signature: signMessage(ch.challenge, k.privateKey),
      });
      setBadge(res.badge);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bidderKeys = keys.filter((k) => k.kind === "bidder");
  const patronKeys = keys.filter((k) => k.kind === "patron");
  const finished = new Set(auctions.map((a) => a.id));
  const tallied = new Set(rounds.map((r) => r.id));

  if (claim) {
    const bytes = Uint8Array.from(atob(claim.image.base64), (c) => c.charCodeAt(0));
    const src = `data:${claim.image.mime};base64,${claim.image.base64}`;
    return (
      <section className="two">
        <img src={src} alt={claim.certificate.piece_id} style={{ borderRadius: 14 }} />
        <div className="stack">
          <h1>It's yours.</h1>
          <p className="muted">
            The original file and a provenance certificate signed by the artist. Nobody knows who you are; the certificate names only your claim key.
          </p>
          <div className="row">
            <button className="primary" onClick={() => saveFile(claim.image.filename, new Blob([bytes], { type: claim.image.mime }))}>
              Download original
            </button>
            <button onClick={() => saveFile(`${claim.certificate.piece_id}.certificate.json`, new Blob([JSON.stringify(claim.certificate, null, 2)], { type: "application/json" }))}>
              Download certificate
            </button>
          </div>
          <pre className="panel small mono" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(claim.certificate, null, 2)}
          </pre>
          <a className="btn" href="/verify">
            Verify a certificate
          </a>
        </div>
      </section>
    );
  }

  if (badge) {
    const text = badge.won
      ? `I anonymously backed the winning piece of Obscura ${badge.round_id}. No name, no amount — just a signature. #Zcash`
      : `I anonymously backed piece ${badge.candidate_id} in Obscura ${badge.round_id}. No name, no amount — just a signature. #Zcash`;
    return (
      <section className="stack" style={{ maxWidth: 640 }}>
        <div className="badge-card stack">
          <span className="pill thriving">Obscura patron</span>
          <h1>
            {badge.won ? "Backed the winner" : "Backed"} · {badge.round_id}
          </h1>
          <p>Piece {badge.candidate_id}. Signed by the artist. The patron is a key, not a person.</p>
          <code className="small muted">{badge.patron_pubkey}</code>
        </div>
        <div className="row">
          <a className="btn primary" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`}>
            Share on X
          </a>
          <button onClick={() => saveFile(`obscura-badge-${badge.round_id}.json`, new Blob([JSON.stringify(badge, null, 2)], { type: "application/json" }))}>
            Download badge
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <h1>Collect</h1>
      <p className="muted">
        Prove you won an auction, or that you were a patron, by signing a one-time challenge with the key from your memo. The key never leaves this
        browser.
      </p>
      {error && <p className="err">{error}</p>}
      <div className="two">
        <div className="panel stack">
          <h2>Pieces you bid on</h2>
          {bidderKeys.length === 0 && <p className="muted small">No bid keys in this browser.</p>}
          {bidderKeys.map((k) => (
            <div key={k.publicKey} className="spread">
              <span className="small">{k.label ?? k.target}</span>
              <button className="primary" disabled={busy || !finished.has(k.target)} onClick={() => collectPiece(k)}>
                {finished.has(k.target) ? "Collect" : "Not settled"}
              </button>
            </div>
          ))}
        </div>
        <div className="panel stack">
          <h2>Patron badges</h2>
          {patronKeys.length === 0 && <p className="muted small">No patron keys in this browser.</p>}
          {patronKeys.map((k) => (
            <div key={k.publicKey} className="spread">
              <span className="small">{k.label ?? k.target}</span>
              <button className="primary" disabled={busy || !tallied.has(k.target)} onClick={() => collectBadge(k)}>
                {tallied.has(k.target) ? "Get badge" : "Voting open"}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <label>Have a key file from another device?</label>
        <input type="file" accept="application/json" onChange={(e) => importKey(e.target.files?.[0])} />
      </div>
    </section>
  );
}
