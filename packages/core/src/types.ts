/** Zatoshis. Always a non-negative safe integer (max supply 2.1e15 < 2^53). */
export type Zat = number;

export const ZAT_PER_ZEC = 100_000_000;

export type Network = "mainnet" | "testnet";

export type Pool = "orchard" | "sapling" | "transparent";

/** One received output, as reported by the detector (or the mock chain). */
export interface IncomingNote {
  txid: string;
  outputIndex: number;
  /** Height of the block the tx was mined in. */
  height: number;
  valueZat: Zat;
  /** Decoded memo text, or null for an empty / non-text memo. */
  memo: string | null;
  /** The address of ours that received it (identifies the round / auction). */
  toAddress: string;
  pool: Pool;
}

export type CandidateId = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export const CANDIDATE_IDS: readonly CandidateId[] = ["a", "b", "c", "d", "e", "f", "g", "h"];

export type RoundStatus = "OPEN_VOTING" | "TALLIED" | "AUCTION_OPEN" | "SETTLING" | "SETTLED";

export type SurvivalState = "thriving" | "steady" | "struggling" | "dormant";
