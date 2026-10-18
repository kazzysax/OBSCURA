// Detector: pulls incoming notes from a ChainSource (mock chain or sidecar) into the store.
// It only ever needs incoming viewing capability; it never sees spend keys.
import type { Account, ChainSource, IncomingNote, OutgoingPayment, Pool, Wallet, Zat } from "@obscura/core";
import type { Store } from "@obscura/store";

export class Detector {
  private readonly chain: ChainSource;
  private readonly store: Store;
  /** Re-scan this many blocks below the last scanned height, to pick up anything a reorg moved. */
  private readonly overlap: number;

  constructor(chain: ChainSource, store: Store, overlap = 3) {
    this.chain = chain;
    this.store = store;
    this.overlap = overlap;
  }

  /** Scan new blocks; store notes that belong to our known addresses. Returns the newly stored notes. */
  async poll(): Promise<{ tip: number; added: IncomingNote[] }> {
    const tip = await this.chain.tipHeight();
    const last = Number(this.store.getMeta("last_scanned_height") ?? "0");
    const from = Math.max(0, last - this.overlap);
    const notes = await this.chain.scanIncoming(from);
    const added: IncomingNote[] = [];
    for (const n of notes) {
      if (!this.store.addressInfo(n.toAddress)) continue; // not one of our round/auction addresses
      if (this.store.addNote(n)) added.push(n);
    }
    this.store.setMeta("last_scanned_height", String(tip));
    this.store.setMeta("chain_tip", String(tip));
    return { tip, added };
  }
}

/**
 * HTTP client for the Rust sidecar (contract in sidecar/src/main.rs).
 * The sidecar holds the keys; this client only asks it to do things.
 */
export class SidecarClient implements ChainSource, Wallet {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`sidecar ${method} ${path}: ${res.status} ${text}`);
    return JSON.parse(text) as T;
  }

  async tipHeight(): Promise<number> {
    return (await this.call<{ height: number }>("GET", "/tip")).height;
  }

  async scanIncoming(fromHeight: number): Promise<IncomingNote[]> {
    const rows = await this.call<
      { txid: string; output_index: number; height: number; value_zat: number; memo: string | null; to_ua: string; pool: Pool }[]
    >("GET", `/scan_incoming?from_height=${fromHeight}`);
    return rows.map((r) => ({
      txid: r.txid,
      outputIndex: r.output_index,
      height: r.height,
      valueZat: r.value_zat,
      memo: r.memo,
      toAddress: r.to_ua,
      pool: r.pool,
    }));
  }

  async newAddress(account: Account): Promise<{ address: string; diversifierIndex: string }> {
    const r = await this.call<{ ua: string; diversifier_index: string }>("POST", "/new_address", { account });
    return { address: r.ua, diversifierIndex: r.diversifier_index };
  }

  async send(from: Account, outputs: OutgoingPayment[]): Promise<{ txid: string }> {
    return this.call("POST", "/send", {
      from,
      outputs: outputs.map((o) => ({ to: o.toUa, amount_zat: o.amountZat, memo: o.memo ?? null })),
    });
  }

  async balance(account: Account): Promise<Zat> {
    return (await this.call<{ orchard_zat: number }>("GET", `/balance?account=${account}`)).orchard_zat;
  }
}
