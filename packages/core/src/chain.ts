// Interfaces between the TypeScript side and the chain. Implemented by the mock chain and by the
// sidecar client. Spend keys never cross this boundary.
import type { IncomingNote, Zat } from "./types.ts";

export type Account = "voting" | "auction";

export interface ChainSource {
  /** Current chain tip height. */
  tipHeight(): Promise<number>;
  /** Every note received by our accounts that was mined at a height ≥ fromHeight. */
  scanIncoming(fromHeight: number): Promise<IncomingNote[]>;
}

export interface OutgoingPayment {
  toUa: string;
  amountZat: Zat;
  memo?: string;
}

export interface Wallet {
  /** A fresh, never-used Orchard-only Unified Address on `account`. */
  newAddress(account: Account): Promise<{ address: string; diversifierIndex: string }>;
  /** Send one shielded transaction paying every output; returns its txid. Throws on failure. */
  send(from: Account, outputs: OutgoingPayment[]): Promise<{ txid: string }>;
  /** Spendable Orchard balance of an account. */
  balance(account: Account): Promise<Zat>;
}
