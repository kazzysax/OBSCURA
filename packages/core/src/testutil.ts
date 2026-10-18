// Helpers shared by tests and the mock chain.
import { encodeUa, TYPECODE } from "./ua.ts";
import type { IncomingNote, Network } from "./types.ts";
import { sha256Hex } from "./sign.ts";

/** A syntactically valid Orchard-only UA derived from a seed string (not spendable; for tests/mock only). */
export function fakeOrchardUa(seed: string, network: Network = "testnet"): string {
  const data = Uint8Array.from(Buffer.from(sha256Hex("ua:" + seed) + sha256Hex("ua2:" + seed), "hex").subarray(0, 43));
  return encodeUa(network, [{ typecode: TYPECODE.orchard, data }]);
}

export function fakeTxid(seed: string): string {
  return sha256Hex("tx:" + seed);
}

let counter = 0;
export function note(partial: Partial<IncomingNote> & Pick<IncomingNote, "height" | "valueZat">): IncomingNote {
  counter++;
  return {
    txid: partial.txid ?? fakeTxid(String(counter)),
    outputIndex: partial.outputIndex ?? 0,
    memo: partial.memo ?? null,
    toAddress: partial.toAddress ?? "round",
    pool: partial.pool ?? "orchard",
    ...partial,
  };
}
