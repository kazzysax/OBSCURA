// Mock chain persisted in the same SQLite file, so the agent process and the web app share it.
// It behaves like the real thing where it matters: payments land in the next block, the tip only
// moves forward, and notes are reported per receiving address.
import {
  fakeOrchardUa,
  fakeTxid,
  type Account,
  type ChainSource,
  type IncomingNote,
  type Network,
  type OutgoingPayment,
  type Pool,
  type Wallet,
  type Zat,
} from "@obscura/core";
import type { Store } from "@obscura/store";
import { randomBytes } from "node:crypto";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mock_outputs (
  txid TEXT NOT NULL, output_index INTEGER NOT NULL, height INTEGER NOT NULL, value_zat INTEGER NOT NULL,
  memo TEXT, to_address TEXT NOT NULL, pool TEXT NOT NULL, PRIMARY KEY (txid, output_index)
);
CREATE TABLE IF NOT EXISTS mock_addresses (address TEXT PRIMARY KEY, account TEXT NOT NULL, idx INTEGER NOT NULL);
`;

type Row = Record<string, unknown>;

export class MockChain implements ChainSource, Wallet {
  private readonly store: Store;
  private readonly network: Network;

  constructor(store: Store, network: Network = "testnet") {
    this.store = store;
    this.network = network;
    store.db.exec(SCHEMA);
    if (store.getMeta("mock_tip") === null) store.setMeta("mock_tip", "1000");
  }

  async tipHeight(): Promise<number> {
    return this.tip();
  }

  tip(): number {
    return Number(this.store.getMeta("mock_tip"));
  }

  /** Mine `n` blocks. */
  mine(n = 1): number {
    const h = this.tip() + n;
    this.store.setMeta("mock_tip", String(h));
    return h;
  }

  /** A patron (or bidder) pays one of our addresses. Lands in the next block. */
  pay(p: { toAddress: string; valueZat: Zat; memo?: string | null; pool?: Pool }): { txid: string; height: number } {
    const txid = fakeTxid(randomBytes(16).toString("hex"));
    const height = this.tip() + 1;
    this.store.db
      .prepare("INSERT INTO mock_outputs (txid, output_index, height, value_zat, memo, to_address, pool) VALUES (?, 0, ?, ?, ?, ?, ?)")
      .run(txid, height, p.valueZat, p.memo ?? null, p.toAddress, p.pool ?? "orchard");
    return { txid, height };
  }

  async scanIncoming(fromHeight: number): Promise<IncomingNote[]> {
    const rows = this.store.db
      .prepare(
        `SELECT o.* FROM mock_outputs o JOIN mock_addresses a ON a.address = o.to_address
         WHERE o.height >= ? AND o.height <= ? ORDER BY o.height, o.txid, o.output_index`,
      )
      .all(fromHeight, this.tip()) as Row[];
    return rows.map((r) => ({
      txid: String(r.txid),
      outputIndex: Number(r.output_index),
      height: Number(r.height),
      valueZat: Number(r.value_zat),
      memo: r.memo == null ? null : String(r.memo),
      toAddress: String(r.to_address),
      pool: String(r.pool) as Pool,
    }));
  }

  async newAddress(account: Account): Promise<{ address: string; diversifierIndex: string }> {
    const r = this.store.db.prepare("SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM mock_addresses WHERE account = ?").get(account) as Row;
    const idx = Number(r.n);
    const address = fakeOrchardUa(`${account}:${idx}:${this.store.getMeta("mock_seed") ?? this.seed()}`, this.network);
    this.store.db.prepare("INSERT INTO mock_addresses (address, account, idx) VALUES (?, ?, ?)").run(address, account, idx);
    return { address, diversifierIndex: String(idx) };
  }

  private seed(): string {
    const s = randomBytes(8).toString("hex");
    this.store.setMeta("mock_seed", s);
    return s;
  }

  async send(from: Account, outputs: OutgoingPayment[]): Promise<{ txid: string }> {
    if (outputs.length === 0) throw new Error("send: no outputs");
    // ZIP-317 style fee: 5000 zat per logical action, at least 2 (outputs + change).
    const fee = 5000 * Math.max(2, outputs.length + 1);
    const need = outputs.reduce((s, o) => s + o.amountZat, 0) + fee;
    const have = await this.balance(from);
    if (need > have) throw new Error(`mock send: insufficient funds on ${from} (${have} < ${need})`);
    const txid = fakeTxid("out:" + randomBytes(16).toString("hex"));
    const height = this.tip() + 1;
    outputs.forEach((o, i) => {
      this.store.db
        .prepare("INSERT INTO mock_outputs (txid, output_index, height, value_zat, memo, to_address, pool) VALUES (?, ?, ?, ?, ?, ?, 'orchard')")
        .run(txid, i, height, o.amountZat, o.memo ?? null, o.toUa);
    });
    // Model the spend (outputs + fee) as a negative row on the sending account so balances stay right.
    this.store.db
      .prepare("INSERT INTO mock_outputs (txid, output_index, height, value_zat, memo, to_address, pool) VALUES (?, ?, ?, ?, NULL, ?, 'spend')")
      .run(txid, outputs.length, height, -need, `spend:${from}`);
    return { txid };
  }

  async balance(account: Account): Promise<Zat> {
    const r = this.store.db
      .prepare(
        `SELECT COALESCE(SUM(o.value_zat), 0) AS s FROM mock_outputs o
         WHERE o.pool = 'orchard' AND o.to_address IN (SELECT address FROM mock_addresses WHERE account = ?)`,
      )
      .get(account) as Row;
    const spent = this.store.db
      .prepare("SELECT COALESCE(SUM(value_zat), 0) AS s FROM mock_outputs WHERE pool = 'spend' AND to_address = ?")
      .get(`spend:${account}`) as Row;
    return Number(r.s) + Number(spent.s);
  }

  /** Outputs we sent to an address (used by tests and the demo to show refunds arriving). */
  receivedBy(address: string): { txid: string; valueZat: Zat; height: number }[] {
    return (this.store.db.prepare("SELECT txid, value_zat, height FROM mock_outputs WHERE to_address = ? AND pool = 'orchard'").all(address) as Row[]).map(
      (r) => ({ txid: String(r.txid), valueZat: Number(r.value_zat), height: Number(r.height) }),
    );
  }
}

/** A throwaway refund address for a simulated bidder. */
export function mockRefundUa(seed: string, network: Network = "testnet"): string {
  return fakeOrchardUa("bidder:" + seed, network);
}
