import type { IncomingNote } from "./types.ts";

/**
 * Canonical ordering of payments, used for every tie-break:
 * (mined height, txid hex ascending, output index ascending).
 */
export function compareCanonical(
  a: Pick<IncomingNote, "height" | "txid" | "outputIndex">,
  b: Pick<IncomingNote, "height" | "txid" | "outputIndex">,
): number {
  if (a.height !== b.height) return a.height - b.height;
  const ta = a.txid.toLowerCase();
  const tb = b.txid.toLowerCase();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.outputIndex - b.outputIndex;
}

/** Inclusive window check: open ≤ height ≤ close. */
export function inWindow(height: number, openHeight: number, closeHeight: number): boolean {
  return height >= openHeight && height <= closeHeight;
}
