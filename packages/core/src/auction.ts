// First-price sealed-bid auction clearing (docs/PROTOCOL.md §3).
import { parseMemo } from "./memo.ts";
import { compareCanonical, inWindow } from "./order.ts";
import type { IncomingNote, Network, Zat } from "./types.ts";

export interface AuctionRules {
  auctionId: string;
  openHeight: number;
  closeHeight: number;
  reserveZat: Zat;
  refundFeeZat: Zat;
  network: Network;
}

export type RefundReason = "outbid" | "below_reserve" | "late" | "wrong_auction" | "malformed_bid" | "no_sale";

export interface Refund {
  /** The bid being refunded; (txid, outputIndex) is the idempotency key. */
  source: IncomingNote;
  toUa: string;
  amountZat: Zat;
  reason: RefundReason;
}

export interface WinningBid {
  note: IncomingNote;
  claimPubkey: string;
  priceZat: Zat;
}

export interface AuctionResult {
  auctionId: string;
  winner: WinningBid | null;
  validBidCount: number;
  refunds: Refund[];
  /** Payments kept by the treasury: unrefundable, or too small to refund after the fee. */
  donations: { note: IncomingNote; reason: string }[];
}

export function clearAuction(notes: readonly IncomingNote[], rules: AuctionRules): AuctionResult {
  const sorted = [...notes].sort(compareCanonical);
  const valid: { note: IncomingNote; claimPubkey: string; refundUa: string }[] = [];
  const refundable: { note: IncomingNote; refundUa: string; reason: RefundReason }[] = [];
  const donations: AuctionResult["donations"] = [];

  for (const note of sorted) {
    if (note.pool !== "orchard") {
      donations.push({ note, reason: "non_orchard" });
      continue;
    }
    const memo = parseMemo(note.memo, rules.network);
    const onTime = inWindow(note.height, rules.openHeight, rules.closeHeight);
    if (memo.kind === "bid") {
      if (memo.auctionId !== rules.auctionId) refundable.push({ note, refundUa: memo.refundUa, reason: "wrong_auction" });
      else if (!onTime) refundable.push({ note, refundUa: memo.refundUa, reason: "late" });
      else if (note.valueZat < rules.reserveZat) refundable.push({ note, refundUa: memo.refundUa, reason: "below_reserve" });
      else valid.push({ note, claimPubkey: memo.claimPubkey, refundUa: memo.refundUa });
    } else if (memo.kind === "bad_bid") {
      refundable.push({ note, refundUa: memo.refundUa, reason: "malformed_bid" });
    } else {
      donations.push({ note, reason: "no_refund_address" });
    }
  }

  // Highest value wins; ties go to the earliest in canonical order.
  const ranked = [...valid].sort((a, b) => b.note.valueZat - a.note.valueZat || compareCanonical(a.note, b.note));
  const top = ranked[0];
  const winner: WinningBid | null = top
    ? { note: top.note, claimPubkey: top.claimPubkey, priceZat: top.note.valueZat }
    : null;

  const toRefund = [
    ...ranked.slice(1).map((b) => ({ note: b.note, refundUa: b.refundUa, reason: "outbid" as RefundReason })),
    ...refundable,
  ].sort((a, b) => compareCanonical(a.note, b.note));

  const refunds: Refund[] = [];
  for (const r of toRefund) {
    const amountZat = r.note.valueZat - rules.refundFeeZat;
    if (amountZat > 0) refunds.push({ source: r.note, toUa: r.refundUa, amountZat, reason: r.reason });
    else donations.push({ note: r.note, reason: "below_refund_fee" });
  }

  return { auctionId: rules.auctionId, winner, validBidCount: valid.length, refunds, donations };
}
