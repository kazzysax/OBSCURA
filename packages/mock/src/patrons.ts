// Simulated patrons and collectors, for demos and tests. Uses the real memo encoders.
import { encodeBid, encodeVote, encodeWhisper, generateKeyPair, type CandidateId, type Network } from "@obscura/core";
import { mockRefundUa, type MockChain } from "./chain.ts";

const NOTES = [
  "the second one feels like a memory",
  "more salt, more wind",
  "love the blue",
  "this one kept me up last night",
  "softer edges next time",
  "it looks like the harbour where I grew up",
  "",
  "",
  "",
];

const WHISPERS = ["lighthouses in fog", "a city seen from underwater", "the colour of old receipts", "night trains", "gardens after rain"];

/** Deterministic PRNG so demos are reproducible from a seed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulatedPatronKey {
  roundId: string;
  candidateId: CandidateId;
  privateKey: string;
  publicKey: string;
}

export function simulateVotes(
  chain: MockChain,
  opts: { roundId: string; address: string; candidateIds: readonly CandidateId[]; count: number; seed: number; minVoteZat: number },
): SimulatedPatronKey[] {
  const r = rng(opts.seed);
  const keys: SimulatedPatronKey[] = [];
  // Give each candidate a hidden "appeal" so results look like taste, not noise.
  const appeal = opts.candidateIds.map(() => 0.3 + r());
  const total = appeal.reduce((a, b) => a + b, 0);
  for (let i = 0; i < opts.count; i++) {
    let x = r() * total;
    let idx = 0;
    while (idx < appeal.length - 1 && x > appeal[idx]!) x -= appeal[idx++]!;
    const candidateId = opts.candidateIds[idx]!;
    const wantsBadge = r() < 0.4;
    const kp = wantsBadge ? generateKeyPair() : null;
    if (kp) keys.push({ roundId: opts.roundId, candidateId, ...kp });
    const noteText = NOTES[Math.floor(r() * NOTES.length)]!;
    const memo = encodeVote({ roundId: opts.roundId, candidateId, patronPubkey: kp?.publicKey, note: noteText || undefined });
    // Mostly small votes, occasionally a large one.
    const valueZat = Math.round(opts.minVoteZat * (1 + r() * 20) * (r() < 0.1 ? 10 : 1));
    chain.pay({ toAddress: opts.address, valueZat, memo });
  }
  return keys;
}

export function simulateWhispers(chain: MockChain, opts: { roundId: string; address: string; count: number; seed: number; minWhisperZat: number }): void {
  const r = rng(opts.seed);
  for (let i = 0; i < opts.count; i++) {
    const text = WHISPERS[Math.floor(r() * WHISPERS.length)]!;
    chain.pay({ toAddress: opts.address, valueZat: Math.round(opts.minWhisperZat * (1 + r() * 10)), memo: encodeWhisper({ roundId: opts.roundId, text }) });
  }
}

export interface SimulatedBidder {
  privateKey: string;
  publicKey: string;
  refundUa: string;
  valueZat: number;
}

export function simulateBids(
  chain: MockChain,
  opts: { auctionId: string; address: string; reserveZat: number; count: number; seed: number; network: Network },
): SimulatedBidder[] {
  const r = rng(opts.seed);
  const bidders: SimulatedBidder[] = [];
  for (let i = 0; i < opts.count; i++) {
    const kp = generateKeyPair();
    const refundUa = mockRefundUa(`${opts.auctionId}:${i}:${opts.seed}`, opts.network);
    // Some bidders bid under the reserve; most bid 1–8× the reserve.
    const valueZat = Math.round(opts.reserveZat * (r() < 0.15 ? 0.5 : 1 + r() * 7));
    chain.pay({ toAddress: opts.address, valueZat, memo: encodeBid({ auctionId: opts.auctionId, claimPubkey: kp.publicKey, refundUa }) });
    bidders.push({ ...kp, refundUa, valueZat });
  }
  return bidders;
}
