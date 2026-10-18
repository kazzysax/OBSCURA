"use client";
import { useState } from "react";
import Link from "next/link";
import { encodeVote, encodeWhisper, filterPublicText, MEMO_MAX_BYTES, byteLength, type CandidateId } from "@obscura/core";
import type { AppState, CandidateView } from "@/lib/view";
import { zec } from "@/lib/view";
import { downloadKey, newKey, saveKey, type StoredKey } from "@/lib/keys";
import { PayDialog, type PaymentSpec } from "./PayDialog";
import { SurvivalPill } from "./SurvivalPill";
import { useAppState } from "./useAppState";

export function LiveRound({ initial }: { initial: AppState }) {
  const s = useAppState(initial);
  const [voting, setVoting] = useState<CandidateView | null>(null);
  const [whisper, setWhisper] = useState(false);
  const r = s.round;

  if (!r) {
    return (
      <section className="stack">
        <h1>The studio is quiet.</h1>
        <p className="muted">No round has opened yet. {s.survival.state === "dormant" ? "The artist is dormant until patrons fund it." : "Waiting for the next block."}</p>
        <Link href="/treasury" className="btn primary">
          Fund the artist
        </Link>
      </section>
    );
  }

  const open = r.status === "OPEN_VOTING" && s.tip < r.closeHeight;
  const maxZat = Math.max(1, ...r.candidates.map((c) => c.totalZat));
  const blocksLeft = Math.max(0, r.closeHeight - s.tip);

  return (
    <>
      <section className="hero">
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="pill">Round {r.id}</span>
            <SurvivalPill state={s.survival.state} />
            {s.mock && <span className="pill">demo chain</span>}
          </div>
          <h1>{r.theme ?? "Untitled"}</h1>
          <p className="muted">
            {open
              ? "Vote for your favourite with shielded ZEC. The amount is your vote's weight. Nobody can see who you are."
              : r.status === "OPEN_VOTING"
                ? "Voting has closed. Counting…"
                : `Voting closed. ${r.winner ? `Piece ${r.winner} won and goes to a sealed-bid auction.` : "No votes this round."}`}
          </p>
        </div>
        <div className="stats">
          <div className="panel">
            <div className="muted small">{open ? "Blocks left" : "Status"}</div>
            <div className="stat">{open ? blocksLeft : r.status.replace("_", " ").toLowerCase()}</div>
          </div>
          <div className="panel">
            <div className="muted small">Votes</div>
            <div className="stat">{r.voteCount}</div>
          </div>
          <div className="panel">
            <div className="muted small">Raised</div>
            <div className="stat">{zec(r.candidates.reduce((n, c) => n + c.totalZat, 0))}</div>
          </div>
        </div>
      </section>

      <section className="grid">
        {r.candidates.map((c) => (
          <article key={c.id} className={`card${r.winner === c.id ? " winner" : ""}`}>
            <img className="art" src={c.image} alt={c.title} />
            <div className="body">
              <div className="spread">
                <h3>{c.title}</h3>
                <span className="pill">{c.id}</span>
              </div>
              <p className="muted small" style={{ flex: 1 }}>
                {c.concept}
              </p>
              <div className="bar" aria-label={`${zec(c.totalZat)} ZEC`}>
                <span style={{ width: `${(c.totalZat / maxZat) * 100}%` }} />
              </div>
              <div className="spread small">
                <span>{zec(c.totalZat)} ZEC</span>
                <span className="muted">{c.votes} {c.votes === 1 ? "vote" : "votes"}</span>
              </div>
              {open && (
                <button className="primary" onClick={() => setVoting(c)}>
                  Vote privately
                </button>
              )}
              {r.winner === c.id && <span className="pill thriving">winner</span>}
            </div>
          </article>
        ))}
      </section>

      <section className="two" style={{ marginTop: 32 }}>
        <div className="panel stack">
          <h2>Notes from patrons</h2>
          {r.notes.length ? r.notes.map((n, i) => <p key={i} className="note">{n}</p>) : <p className="muted">No notes yet. Add one to your vote.</p>}
        </div>
        <div className="panel stack">
          <h2>Whisper a theme</h2>
          <p className="muted small">
            Pay at least {zec(s.minWhisperZat)} ZEC to suggest a theme for the next round. The artist reads whispers ranked by amount and decides for
            itself; its journal says which it followed.
          </p>
          {r.whispers.length > 0 && <p className="small">This round so far: {r.whispers.map((w) => `“${w}”`).join(", ")}</p>}
          <button disabled={!open} onClick={() => setWhisper(true)}>
            Whisper
          </button>
        </div>
      </section>

      {voting && <VoteDialog state={s} candidate={voting} onClose={() => setVoting(null)} />}
      {whisper && <WhisperDialog state={s} onClose={() => setWhisper(false)} />}
    </>
  );
}

function VoteDialog({ state, candidate, onClose }: { state: AppState; candidate: CandidateView; onClose: () => void }) {
  const r = state.round!;
  const [amount, setAmount] = useState(String(Math.max(state.minVoteZat / 1e8, 0.01)));
  const [note, setNote] = useState("");
  const [badge, setBadge] = useState(true);
  const [key, setKey] = useState<StoredKey | null>(null);
  const [spec, setSpec] = useState<PaymentSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepare = () => {
    const zat = Math.round(Number(amount) * 1e8);
    if (!Number.isFinite(zat) || zat < state.minVoteZat) return setError(`Minimum vote is ${zec(state.minVoteZat, 8)} ZEC.`);
    if (note && !filterPublicText(note)) setError("Your note won't be shown publicly (links, addresses and some words are filtered). It still counts as a vote.");
    else setError(null);
    const k = badge ? newKey("patron", r.id, `${r.id} ${candidate.id} “${candidate.title}”`) : null;
    let memo: string;
    try {
      memo = encodeVote({ roundId: r.id, candidateId: candidate.id as CandidateId, patronPubkey: k?.publicKey, note: note.trim() || undefined });
    } catch {
      return setError(`Memo too long (max ${MEMO_MAX_BYTES} bytes).`);
    }
    if (k) saveKey(k);
    setKey(k);
    setSpec({ title: `Vote for “${candidate.title}”`, address: r.address, amountZat: zat, memo, label: `Obscura ${r.id} vote ${candidate.id}` });
  };

  if (spec)
    return (
      <PayDialog spec={spec} mock={state.mock} onClose={onClose}>
        {key && (
          <div className="ok">
            A patron key was saved in this browser so you can claim a badge after voting closes.{" "}
            <button onClick={() => downloadKey(key)}>Download a backup</button>
          </div>
        )}
      </PayDialog>
    );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
        <h2>Vote for “{candidate.title}”</h2>
        <div>
          <label>Amount (ZEC) — your vote's weight</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label>Note to the artist (optional, public if it passes the filter) — {byteLength(note)} bytes</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="paint the sea next time" />
        </div>
        <label className="row" style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={badge} onChange={(e) => setBadge(e.target.checked)} style={{ width: "auto" }} />
          Get an anonymous patron badge (adds a one-time public key to the memo)
        </label>
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

function WhisperDialog({ state, onClose }: { state: AppState; onClose: () => void }) {
  const r = state.round!;
  const [text, setText] = useState("");
  const [amount, setAmount] = useState(String(state.minWhisperZat / 1e8));
  const [spec, setSpec] = useState<PaymentSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (spec) return <PayDialog spec={spec} mock={state.mock} onClose={onClose} />;
  const prepare = () => {
    const zat = Math.round(Number(amount) * 1e8);
    if (!filterPublicText(text)) return setError("That whisper wouldn't pass the content filter (no links, addresses or slurs).");
    if (!Number.isFinite(zat) || zat < state.minWhisperZat) return setError(`Minimum whisper is ${zec(state.minWhisperZat, 8)} ZEC.`);
    try {
      setSpec({ title: "Whisper a theme", address: r.address, amountZat: zat, memo: encodeWhisper({ roundId: r.id, text: text.trim() }), label: `Obscura ${r.id} whisper` });
    } catch {
      setError("Too long.");
    }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
        <h2>Whisper a theme</h2>
        <div>
          <label>Theme</label>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="lighthouses in fog" />
        </div>
        <div>
          <label>Amount (ZEC)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
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
