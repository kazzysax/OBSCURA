// Obscura memo codec (docs/PROTOCOL.md). Memos are UTF-8 text, max 512 bytes (ZIP-302).
import type { CandidateId, Network } from "./types.ts";
import { CANDIDATE_IDS } from "./types.ts";
import { hasOrchardReceiver } from "./ua.ts";

export const MEMO_PREFIX = "obscura:v0:";
export const MEMO_MAX_BYTES = 512;

const ROUND_ID = /^r\d{4,}$/;
const AUCTION_ID = /^a\d{4,}$/;
const PUBKEY_HEX = /^[0-9a-f]{64}$/;

export type ParsedMemo =
  | { kind: "vote"; roundId: string; candidateId: CandidateId; patronPubkey: string | null; note: string | null }
  | { kind: "whisper"; roundId: string; text: string }
  | { kind: "bid"; auctionId: string; claimPubkey: string; refundUa: string }
  /** A bid-shaped memo that is malformed but still names a usable refund address. */
  | { kind: "bad_bid"; refundUa: string; auctionId: string | null }
  | { kind: "invalid"; reason: string };

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function checkSize(memo: string): string {
  if (byteLength(memo) > MEMO_MAX_BYTES) throw new Error(`memo exceeds ${MEMO_MAX_BYTES} bytes`);
  return memo;
}

/** Normalise a decoded memo: drop ZIP-302 zero padding and surrounding whitespace. */
export function normaliseMemo(memo: string | null): string | null {
  if (memo === null) return null;
  const s = memo.replace(/\0+$/u, "").trim();
  return s.length ? s : null;
}

export function isRoundId(s: string): boolean {
  return ROUND_ID.test(s);
}
export function isAuctionId(s: string): boolean {
  return AUCTION_ID.test(s);
}
export function isPubkeyHex(s: string): boolean {
  return PUBKEY_HEX.test(s);
}

export function encodeVote(v: { roundId: string; candidateId: CandidateId; patronPubkey?: string; note?: string }): string {
  if (!isRoundId(v.roundId) || !CANDIDATE_IDS.includes(v.candidateId)) throw new Error("bad vote ids");
  if (v.patronPubkey !== undefined && !isPubkeyHex(v.patronPubkey)) throw new Error("bad patron pubkey");
  let memo = `${MEMO_PREFIX}v:${v.roundId}:${v.candidateId}`;
  if (v.patronPubkey || v.note) memo += `:${v.patronPubkey ?? ""}`;
  if (v.note) memo += `:${v.note}`;
  return checkSize(memo);
}

export function encodeWhisper(w: { roundId: string; text: string }): string {
  if (!isRoundId(w.roundId) || !w.text.trim()) throw new Error("bad whisper");
  return checkSize(`${MEMO_PREFIX}w:${w.roundId}:${w.text}`);
}

export function encodeBid(b: { auctionId: string; claimPubkey: string; refundUa: string }): string {
  if (!isAuctionId(b.auctionId) || !isPubkeyHex(b.claimPubkey)) throw new Error("bad bid ids");
  return checkSize(`${MEMO_PREFIX}b:${b.auctionId}:${b.claimPubkey}:${b.refundUa}`);
}

/**
 * Parse an incoming memo. Never throws. `network` is used to check refund addresses.
 * Money decisions are made by tally/auction code from the result, never from free text.
 */
export function parseMemo(raw: string | null, network: Network): ParsedMemo {
  const memo = normaliseMemo(raw);
  if (memo === null) return { kind: "invalid", reason: "empty" };
  if (byteLength(memo) > MEMO_MAX_BYTES) return { kind: "invalid", reason: "too long" };
  if (!memo.startsWith(MEMO_PREFIX)) return { kind: "invalid", reason: "not an obscura memo" };
  const parts = memo.slice(MEMO_PREFIX.length).split(":");
  const type = parts[0];

  if (type === "v") {
    const [, roundId = "", candidateId = "", ...rest] = parts;
    if (!isRoundId(roundId)) return { kind: "invalid", reason: "bad round id" };
    if (!CANDIDATE_IDS.includes(candidateId as CandidateId)) return { kind: "invalid", reason: "bad candidate" };
    let patronPubkey: string | null = null;
    let noteParts = rest;
    if (rest.length > 0 && isPubkeyHex(rest[0]!)) {
      patronPubkey = rest[0]!;
      noteParts = rest.slice(1);
    } else if (rest.length > 0 && rest[0] === "") {
      noteParts = rest.slice(1);
    }
    const note = noteParts.join(":").trim();
    return { kind: "vote", roundId, candidateId: candidateId as CandidateId, patronPubkey, note: note || null };
  }

  if (type === "w") {
    const [, roundId = "", ...rest] = parts;
    const text = rest.join(":").trim();
    if (!isRoundId(roundId) || !text) return { kind: "invalid", reason: "bad whisper" };
    return { kind: "whisper", roundId, text };
  }

  if (type === "b") {
    const [, auctionId = "", claimPubkey = "", ...rest] = parts;
    const refundUa = rest.join(":");
    const refundOk = hasOrchardReceiver(refundUa, network);
    if (isAuctionId(auctionId) && isPubkeyHex(claimPubkey) && refundOk && rest.length === 1) {
      return { kind: "bid", auctionId, claimPubkey, refundUa };
    }
    // Salvage a refund address if one is anywhere in the memo.
    const salvage = refundOk ? refundUa : parts.find((p) => hasOrchardReceiver(p, network));
    if (salvage) return { kind: "bad_bid", refundUa: salvage, auctionId: isAuctionId(auctionId) ? auctionId : null };
    return { kind: "invalid", reason: "bad bid, no refund address" };
  }

  return { kind: "invalid", reason: "unknown memo type" };
}

// --- Public text filter ------------------------------------------------------

const NOTE_MAX_CHARS = 280;
// Deliberately short; extend for production. Matching is on whole words, case-insensitive.
const BLOCKLIST = ["fuck", "shit", "cunt", "nigger", "faggot", "retard", "kys"];
const URL_LIKE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|ru)\b)/i;
const ADDRESS_LIKE = /\b(u1|utest1|zs1|t1|t3)[0-9a-z]{20,}\b/i;

/**
 * Returns the text if it may be shown publicly / given to the agent, else null.
 * Strips control characters and clamps length.
 */
export function filterPublicText(text: string | null): string | null {
  if (!text) return null;
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const words = clean.toLowerCase().split(/[^a-z0-9]+/);
  if (words.some((w) => BLOCKLIST.includes(w))) return null;
  if (URL_LIKE.test(clean) || ADDRESS_LIKE.test(clean)) return null;
  return clean.length > NOTE_MAX_CHARS ? clean.slice(0, NOTE_MAX_CHARS - 1) + "…" : clean;
}
