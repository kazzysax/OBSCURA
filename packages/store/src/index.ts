// SQLite store (node:sqlite). The single source of truth shared by the agent loop, detector and web app.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AuctionResult,
  CandidateId,
  IncomingNote,
  Pool,
  RoundStatus,
  SurvivalState,
  TallyResult,
  Zat,
} from "@obscura/core";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS addresses (
  address TEXT PRIMARY KEY, account TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, diversifier_index TEXT
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, status TEXT NOT NULL,
  theme TEXT, address TEXT NOT NULL, open_height INTEGER NOT NULL, close_height INTEGER NOT NULL,
  survival_state TEXT NOT NULL, pieces INTEGER NOT NULL, reserve_zat INTEGER NOT NULL,
  winner TEXT, tally_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS candidates (
  round_id TEXT NOT NULL, candidate_id TEXT NOT NULL, title TEXT NOT NULL, concept TEXT NOT NULL,
  image_file TEXT NOT NULL, image_sha256 TEXT NOT NULL, mime TEXT NOT NULL,
  PRIMARY KEY (round_id, candidate_id)
);
CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY, round_id TEXT NOT NULL UNIQUE, candidate_id TEXT NOT NULL, address TEXT NOT NULL,
  open_height INTEGER NOT NULL, close_height INTEGER NOT NULL, reserve_zat INTEGER NOT NULL,
  status TEXT NOT NULL, winner_claim_pubkey TEXT, price_zat INTEGER, valid_bid_count INTEGER, result_json TEXT
);
CREATE TABLE IF NOT EXISTS notes (
  txid TEXT NOT NULL, output_index INTEGER NOT NULL, height INTEGER NOT NULL, value_zat INTEGER NOT NULL,
  memo TEXT, to_address TEXT NOT NULL, pool TEXT NOT NULL, received_at TEXT NOT NULL,
  PRIMARY KEY (txid, output_index)
);
CREATE INDEX IF NOT EXISTS notes_addr ON notes (to_address);
CREATE TABLE IF NOT EXISTS refunds (
  source_txid TEXT NOT NULL, source_output_index INTEGER NOT NULL, auction_id TEXT NOT NULL,
  to_ua TEXT NOT NULL, amount_zat INTEGER NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL, txid TEXT, error TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (source_txid, source_output_index)
);
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT, round_id TEXT, created_at TEXT NOT NULL,
  survival_state TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, whispers_json TEXT
);
CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY, kind TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS claims (auction_id TEXT PRIMARY KEY, claim_pubkey TEXT NOT NULL, certificate_json TEXT NOT NULL, claimed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS badges (
  round_id TEXT NOT NULL, patron_pubkey TEXT NOT NULL, candidate_id TEXT NOT NULL, certificate_json TEXT NOT NULL,
  PRIMARY KEY (round_id, patron_pubkey, candidate_id)
);
CREATE TABLE IF NOT EXISTS spending (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, amount_zat INTEGER NOT NULL, what TEXT NOT NULL);
`;

export interface RoundRow {
  id: string;
  number: number;
  status: RoundStatus;
  theme: string | null;
  address: string;
  openHeight: number;
  closeHeight: number;
  survivalState: SurvivalState;
  pieces: number;
  reserveZat: Zat;
  winner: CandidateId | null;
  tally: TallyResult | null;
  createdAt: string;
}

export interface CandidateRow {
  roundId: string;
  candidateId: CandidateId;
  title: string;
  concept: string;
  imageFile: string;
  imageSha256: string;
  mime: string;
}

export type AuctionStatus = "OPEN" | "CLEARED" | "SETTLED";

export interface AuctionRow {
  id: string;
  roundId: string;
  candidateId: CandidateId;
  address: string;
  openHeight: number;
  closeHeight: number;
  reserveZat: Zat;
  status: AuctionStatus;
  winnerClaimPubkey: string | null;
  priceZat: Zat | null;
  validBidCount: number | null;
  result: AuctionResult | null;
}

export type RefundStatus = "pending" | "sending" | "sent" | "failed";

export interface RefundRow {
  sourceTxid: string;
  sourceOutputIndex: number;
  auctionId: string;
  toUa: string;
  amountZat: Zat;
  reason: string;
  status: RefundStatus;
  txid: string | null;
  error: string | null;
}

export interface JournalRow {
  id: number;
  roundId: string | null;
  createdAt: string;
  survivalState: SurvivalState;
  title: string;
  body: string;
  whispers: { text: string; used: boolean }[];
}

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // --- meta ---
  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
    return r ? String(r.value) : null;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  // --- addresses ---
  addAddress(a: { address: string; account: "voting" | "auction"; kind: "round" | "auction"; refId: string; diversifierIndex?: string }): void {
    const existing = this.db.prepare("SELECT ref_id FROM addresses WHERE address = ?").get(a.address);
    if (existing) throw new Error("address reuse: " + a.address);
    this.db
      .prepare("INSERT INTO addresses (address, account, kind, ref_id, diversifier_index) VALUES (?, ?, ?, ?, ?)")
      .run(a.address, a.account, a.kind, a.refId, a.diversifierIndex ?? null);
  }
  addressInfo(address: string): { account: string; kind: string; refId: string } | null {
    const r = this.db.prepare("SELECT account, kind, ref_id FROM addresses WHERE address = ?").get(address) as Row | undefined;
    return r ? { account: String(r.account), kind: String(r.kind), refId: String(r.ref_id) } : null;
  }

  // --- notes ---
  /** Insert a note; returns false if it was already known (idempotent). */
  addNote(n: IncomingNote): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO notes (txid, output_index, height, value_zat, memo, to_address, pool, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(n.txid, n.outputIndex, n.height, n.valueZat, n.memo, n.toAddress, n.pool, now());
    return Number(res.changes) > 0;
  }
  notesFor(address: string): IncomingNote[] {
    return (this.db.prepare("SELECT * FROM notes WHERE to_address = ?").all(address) as Row[]).map(toNote);
  }
  allNotes(): (IncomingNote & { receivedAt: string })[] {
    return (this.db.prepare("SELECT * FROM notes ORDER BY height, txid, output_index").all() as Row[]).map((r) => ({
      ...toNote(r),
      receivedAt: String(r.received_at),
    }));
  }
  /** Sum of all received Orchard value. */
  totalReceivedZat(): Zat {
    const r = this.db.prepare("SELECT COALESCE(SUM(value_zat), 0) AS s FROM notes WHERE pool = 'orchard'").get() as Row;
    return Number(r.s);
  }

  // --- rounds ---
  insertRound(r: Omit<RoundRow, "tally" | "winner" | "createdAt">): void {
    this.db
      .prepare(
        `INSERT INTO rounds (id, number, status, theme, address, open_height, close_height, survival_state, pieces, reserve_zat, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.id, r.number, r.status, r.theme, r.address, r.openHeight, r.closeHeight, r.survivalState, r.pieces, r.reserveZat, now());
  }
  updateRound(id: string, patch: { status?: RoundStatus; winner?: CandidateId | null; tally?: TallyResult }): void {
    const cur = this.getRound(id);
    if (!cur) throw new Error("no round " + id);
    this.db
      .prepare("UPDATE rounds SET status = ?, winner = ?, tally_json = ? WHERE id = ?")
      .run(
        patch.status ?? cur.status,
        patch.winner !== undefined ? patch.winner : cur.winner,
        patch.tally ? JSON.stringify(patch.tally) : cur.tally ? JSON.stringify(cur.tally) : null,
        id,
      );
  }
  getRound(id: string): RoundRow | null {
    const r = this.db.prepare("SELECT * FROM rounds WHERE id = ?").get(id) as Row | undefined;
    return r ? toRound(r) : null;
  }
  listRounds(): RoundRow[] {
    return (this.db.prepare("SELECT * FROM rounds ORDER BY number DESC").all() as Row[]).map(toRound);
  }
  latestRound(): RoundRow | null {
    const r = this.db.prepare("SELECT * FROM rounds ORDER BY number DESC LIMIT 1").get() as Row | undefined;
    return r ? toRound(r) : null;
  }

  // --- candidates ---
  insertCandidate(c: CandidateRow): void {
    this.db
      .prepare("INSERT INTO candidates (round_id, candidate_id, title, concept, image_file, image_sha256, mime) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(c.roundId, c.candidateId, c.title, c.concept, c.imageFile, c.imageSha256, c.mime);
  }
  candidates(roundId: string): CandidateRow[] {
    return (this.db.prepare("SELECT * FROM candidates WHERE round_id = ? ORDER BY candidate_id").all(roundId) as Row[]).map((r) => ({
      roundId: String(r.round_id),
      candidateId: String(r.candidate_id) as CandidateId,
      title: String(r.title),
      concept: String(r.concept),
      imageFile: String(r.image_file),
      imageSha256: String(r.image_sha256),
      mime: String(r.mime),
    }));
  }

  // --- auctions ---
  insertAuction(a: Pick<AuctionRow, "id" | "roundId" | "candidateId" | "address" | "openHeight" | "closeHeight" | "reserveZat">): void {
    this.db
      .prepare(
        `INSERT INTO auctions (id, round_id, candidate_id, address, open_height, close_height, reserve_zat, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      )
      .run(a.id, a.roundId, a.candidateId, a.address, a.openHeight, a.closeHeight, a.reserveZat);
  }
  recordAuctionResult(id: string, result: AuctionResult): void {
    this.db
      .prepare("UPDATE auctions SET status = 'CLEARED', winner_claim_pubkey = ?, price_zat = ?, valid_bid_count = ?, result_json = ? WHERE id = ?")
      .run(result.winner?.claimPubkey ?? null, result.winner?.priceZat ?? null, result.validBidCount, JSON.stringify(result), id);
  }
  setAuctionStatus(id: string, status: AuctionStatus): void {
    this.db.prepare("UPDATE auctions SET status = ? WHERE id = ?").run(status, id);
  }
  getAuction(id: string): AuctionRow | null {
    const r = this.db.prepare("SELECT * FROM auctions WHERE id = ?").get(id) as Row | undefined;
    return r ? toAuction(r) : null;
  }
  auctionForRound(roundId: string): AuctionRow | null {
    const r = this.db.prepare("SELECT * FROM auctions WHERE round_id = ?").get(roundId) as Row | undefined;
    return r ? toAuction(r) : null;
  }
  listAuctions(): AuctionRow[] {
    return (this.db.prepare("SELECT * FROM auctions ORDER BY id DESC").all() as Row[]).map(toAuction);
  }

  // --- refunds ---
  /** Queue refunds; existing rows (same source note) are left untouched, so this is idempotent. */
  queueRefunds(auctionId: string, refunds: AuctionResult["refunds"]): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO refunds (source_txid, source_output_index, auction_id, to_ua, amount_zat, reason, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    );
    for (const r of refunds) stmt.run(r.source.txid, r.source.outputIndex, auctionId, r.toUa, r.amountZat, r.reason, now());
  }
  refunds(filter?: { auctionId?: string; status?: RefundStatus }): RefundRow[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter?.auctionId) where.push("auction_id = ?"), args.push(filter.auctionId);
    if (filter?.status) where.push("status = ?"), args.push(filter.status);
    const sql = `SELECT * FROM refunds ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY source_txid, source_output_index`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => ({
      sourceTxid: String(r.source_txid),
      sourceOutputIndex: Number(r.source_output_index),
      auctionId: String(r.auction_id),
      toUa: String(r.to_ua),
      amountZat: Number(r.amount_zat),
      reason: String(r.reason),
      status: String(r.status) as RefundStatus,
      txid: r.txid == null ? null : String(r.txid),
      error: r.error == null ? null : String(r.error),
    }));
  }
  markRefund(sourceTxid: string, sourceOutputIndex: number, patch: { status: RefundStatus; txid?: string; error?: string }): void {
    this.db
      .prepare("UPDATE refunds SET status = ?, txid = ?, error = ?, updated_at = ? WHERE source_txid = ? AND source_output_index = ?")
      .run(patch.status, patch.txid ?? null, patch.error ?? null, now(), sourceTxid, sourceOutputIndex);
  }

  // --- journal ---
  addJournal(j: Omit<JournalRow, "id" | "createdAt">): number {
    const res = this.db
      .prepare("INSERT INTO journal (round_id, created_at, survival_state, title, body, whispers_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(j.roundId, now(), j.survivalState, j.title, j.body, JSON.stringify(j.whispers));
    return Number(res.lastInsertRowid);
  }
  journal(limit = 50): JournalRow[] {
    return (this.db.prepare("SELECT * FROM journal ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map((r) => ({
      id: Number(r.id),
      roundId: r.round_id == null ? null : String(r.round_id),
      createdAt: String(r.created_at),
      survivalState: String(r.survival_state) as SurvivalState,
      title: String(r.title),
      body: String(r.body),
      whispers: r.whispers_json ? JSON.parse(String(r.whispers_json)) : [],
    }));
  }

  // --- challenges (single use, expiring) ---
  addChallenge(nonce: string, kind: string, targetId: string): void {
    this.db.prepare("INSERT INTO challenges (nonce, kind, target_id, created_at) VALUES (?, ?, ?, ?)").run(nonce, kind, targetId, Date.now());
  }
  /** Atomically consume a challenge. Returns false if unknown, used, expired or for another target. */
  consumeChallenge(nonce: string, kind: string, targetId: string, maxAgeMs = 10 * 60_000): boolean {
    const res = this.db
      .prepare("UPDATE challenges SET used = 1 WHERE nonce = ? AND kind = ? AND target_id = ? AND used = 0 AND created_at >= ?")
      .run(nonce, kind, targetId, Date.now() - maxAgeMs);
    return Number(res.changes) === 1;
  }

  // --- claims and badges ---
  saveClaim(auctionId: string, claimPubkey: string, certificate: object): void {
    this.db
      .prepare("INSERT OR REPLACE INTO claims (auction_id, claim_pubkey, certificate_json, claimed_at) VALUES (?, ?, ?, ?)")
      .run(auctionId, claimPubkey, JSON.stringify(certificate), now());
  }
  getClaim(auctionId: string): { claimPubkey: string; certificate: unknown; claimedAt: string } | null {
    const r = this.db.prepare("SELECT * FROM claims WHERE auction_id = ?").get(auctionId) as Row | undefined;
    return r ? { claimPubkey: String(r.claim_pubkey), certificate: JSON.parse(String(r.certificate_json)), claimedAt: String(r.claimed_at) } : null;
  }
  saveBadge(roundId: string, patronPubkey: string, candidateId: string, certificate: object): void {
    this.db
      .prepare("INSERT OR REPLACE INTO badges (round_id, patron_pubkey, candidate_id, certificate_json) VALUES (?, ?, ?, ?)")
      .run(roundId, patronPubkey, candidateId, JSON.stringify(certificate));
  }
  badgeCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS c FROM badges").get() as Row).c);
  }

  // --- treasury ---
  addSpending(amountZat: Zat, what: string): void {
    this.db.prepare("INSERT INTO spending (at, amount_zat, what) VALUES (?, ?, ?)").run(now(), amountZat, what);
  }
  totalSpentZat(): Zat {
    return Number((this.db.prepare("SELECT COALESCE(SUM(amount_zat), 0) AS s FROM spending").get() as Row).s);
  }
  totalRefundedZat(): Zat {
    // Pending refunds are owed: count them as spent so the treasury never looks richer than it is.
    return Number((this.db.prepare("SELECT COALESCE(SUM(amount_zat), 0) AS s FROM refunds WHERE status IN ('pending', 'sending', 'sent')").get() as Row).s);
  }
  /** Bid value held for still-open auctions (not the artist's money yet). */
  heldForOpenAuctionsZat(): Zat {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(n.value_zat), 0) AS s FROM notes n JOIN auctions a ON a.address = n.to_address
         WHERE a.status = 'OPEN' AND n.pool = 'orchard'`,
      )
      .get() as Row;
    return Number(r.s);
  }
}

function toNote(r: Row): IncomingNote {
  return {
    txid: String(r.txid),
    outputIndex: Number(r.output_index),
    height: Number(r.height),
    valueZat: Number(r.value_zat),
    memo: r.memo == null ? null : String(r.memo),
    toAddress: String(r.to_address),
    pool: String(r.pool) as Pool,
  };
}

function toRound(r: Row): RoundRow {
  return {
    id: String(r.id),
    number: Number(r.number),
    status: String(r.status) as RoundStatus,
    theme: r.theme == null ? null : String(r.theme),
    address: String(r.address),
    openHeight: Number(r.open_height),
    closeHeight: Number(r.close_height),
    survivalState: String(r.survival_state) as SurvivalState,
    pieces: Number(r.pieces),
    reserveZat: Number(r.reserve_zat),
    winner: r.winner == null ? null : (String(r.winner) as CandidateId),
    tally: r.tally_json ? JSON.parse(String(r.tally_json)) : null,
    createdAt: String(r.created_at),
  };
}

function toAuction(r: Row): AuctionRow {
  return {
    id: String(r.id),
    roundId: String(r.round_id),
    candidateId: String(r.candidate_id) as CandidateId,
    address: String(r.address),
    openHeight: Number(r.open_height),
    closeHeight: Number(r.close_height),
    reserveZat: Number(r.reserve_zat),
    status: String(r.status) as AuctionStatus,
    winnerClaimPubkey: r.winner_claim_pubkey == null ? null : String(r.winner_claim_pubkey),
    priceZat: r.price_zat == null ? null : Number(r.price_zat),
    validBidCount: r.valid_bid_count == null ? null : Number(r.valid_bid_count),
    result: r.result_json ? JSON.parse(String(r.result_json)) : null,
  };
}

/** Treasury = received − refunds owed/sent − compute spent − bids still held in open auctions. */
export function treasuryZat(store: Store): Zat {
  return Math.max(0, store.totalReceivedZat() - store.totalRefundedZat() - store.totalSpentZat() - store.heldForOpenAuctionsZat());
}
