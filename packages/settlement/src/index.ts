// Settlement: sends the refunds computed by core's clearAuction. Deterministic and idempotent;
// the AI agent has no path into this code.
import { MEMO_PREFIX, type Wallet, type Zat } from "@obscura/core";
import type { RefundRow, Store } from "@obscura/store";

export interface SettleOptions {
  batchSize: number;
  refundFeeZat: Zat;
}

export interface SettleReport {
  sent: { txid: string; count: number; totalZat: Zat }[];
  failed: { error: string; count: number }[];
  /** Refunds stuck in "sending" from an earlier crash; need checking against the chain by hand. */
  needsReconcile: RefundRow[];
  done: boolean;
}

/**
 * Send all pending refunds for an auction, in batches of `batchSize` outputs per transaction.
 *
 * Crash safety: rows go pending → sending → sent. A row left in "sending" means we may or may not
 * have broadcast; it is never retried automatically (a retry could double-pay).
 */
export async function settleAuction(store: Store, wallet: Wallet, auctionId: string, opts: SettleOptions): Promise<SettleReport> {
  const report: SettleReport = { sent: [], failed: [], needsReconcile: store.refunds({ auctionId, status: "sending" }), done: false };
  const pending = store.refunds({ auctionId, status: "pending" });

  for (let i = 0; i < pending.length; i += opts.batchSize) {
    const batch = pending.slice(i, i + opts.batchSize);
    store.tx(() => batch.forEach((r) => store.markRefund(r.sourceTxid, r.sourceOutputIndex, { status: "sending" })));
    try {
      const { txid } = await wallet.send(
        "auction",
        batch.map((r) => ({ toUa: r.toUa, amountZat: r.amountZat, memo: `${MEMO_PREFIX}refund:${auctionId}:${r.reason}` })),
      );
      store.tx(() => {
        batch.forEach((r) => store.markRefund(r.sourceTxid, r.sourceOutputIndex, { status: "sent", txid }));
        store.addSpending(opts.refundFeeZat * batch.length, `refund fees ${auctionId}`);
      });
      report.sent.push({ txid, count: batch.length, totalZat: batch.reduce((s, r) => s + r.amountZat, 0) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // We can't tell whether a failed call broadcast anything (e.g. a timeout), so never auto-retry:
      // "failed" rows are retried only by retryFailedRefunds after someone checks the chain.
      store.tx(() => batch.forEach((r) => store.markRefund(r.sourceTxid, r.sourceOutputIndex, { status: "failed", error })));
      report.failed.push({ error, count: batch.length });
      break;
    }
  }

  const left = store.refunds({ auctionId }).filter((r) => r.status !== "sent");
  report.done = left.length === 0;
  return report;
}

/** Operator action, after confirming on-chain that the failed/sending refunds were NOT paid. */
export function retryFailedRefunds(store: Store, auctionId: string, includeSending = false): number {
  const rows = store.refunds({ auctionId }).filter((r) => r.status === "failed" || (includeSending && r.status === "sending"));
  store.tx(() => rows.forEach((r) => store.markRefund(r.sourceTxid, r.sourceOutputIndex, { status: "pending" })));
  return rows.length;
}
export * from "./claims.ts";
