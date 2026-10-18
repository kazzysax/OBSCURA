// Round state machine (docs/PROTOCOL.md "Round lifecycle"). Driven only by block heights and
// deterministic code; the brain is consulted for creative output when a round opens.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  auctionId as makeAuctionId,
  CANDIDATE_IDS,
  clampDecision,
  clearAuction,
  pieceId,
  roundId as makeRoundId,
  sha256Hex,
  survival as computeSurvival,
  tallyRound,
  ZAT_PER_ZEC,
  type ObscuraConfig,
  type Survival,
  type Wallet,
} from "@obscura/core";
import { treasuryZat, type RoundRow, type Store } from "@obscura/store";
import { settleAuction } from "@obscura/settlement";
import type { ArtistBrain, ReflectContext } from "./brain.ts";
import type { ImageGenerator } from "./render.ts";

export type Event = { at: number; kind: string; message: string };

export interface OrchestratorDeps {
  store: Store;
  wallet: Wallet;
  brain: ArtistBrain;
  images: ImageGenerator;
  config: ObscuraConfig;
  log?: (e: Event) => void;
}

export class Orchestrator {
  private readonly d: OrchestratorDeps;

  constructor(d: OrchestratorDeps) {
    this.d = d;
  }

  private log(kind: string, message: string, tip: number): void {
    this.d.log?.({ at: tip, kind, message });
  }

  survival(): Survival & { treasuryZat: number } {
    const t = treasuryZat(this.d.store);
    return { ...computeSurvival({ treasuryZat: t, dailySpendZat: this.d.config.dailySpendZat, roundCostZat: this.d.config.roundCostZat }), treasuryZat: t };
  }

  /** The public donation address (voting account). Created once. */
  async ensureDonationAddress(): Promise<string> {
    const existing = this.d.store.getMeta("donation_address");
    if (existing) return existing;
    const { address, diversifierIndex } = await this.d.wallet.newAddress("voting");
    this.d.store.addAddress({ address, account: "voting", kind: "round", refId: "donation", diversifierIndex });
    this.d.store.setMeta("donation_address", address);
    return address;
  }

  /** Advance the state machine as far as the current tip allows. Safe to call repeatedly. */
  async step(tip: number): Promise<void> {
    for (let i = 0; i < 8; i++) {
      const before = this.fingerprint();
      await this.stepOnce(tip);
      if (this.fingerprint() === before) return;
    }
  }

  private fingerprint(): string {
    const r = this.d.store.latestRound();
    return r ? `${r.id}:${r.status}` : "none";
  }

  private async stepOnce(tip: number): Promise<void> {
    const { store, config } = this.d;
    const round = store.latestRound();
    const settledAt = (h: number) => tip >= h + config.confirmations;

    if (!round || round.status === "SETTLED") {
      await this.maybeOpenRound(tip, round);
      return;
    }

    if (round.status === "OPEN_VOTING" && settledAt(round.closeHeight)) {
      await this.closeVoting(round, tip);
      return;
    }

    if (round.status === "TALLIED") {
      await this.openAuctionOrFinish(round, tip);
      return;
    }

    if (round.status === "AUCTION_OPEN") {
      const auction = store.auctionForRound(round.id)!;
      if (settledAt(auction.closeHeight)) {
        const result = clearAuction(store.notesFor(auction.address), {
          auctionId: auction.id,
          openHeight: auction.openHeight,
          closeHeight: auction.closeHeight,
          reserveZat: auction.reserveZat,
          refundFeeZat: config.refundFeeZat,
          network: config.network,
        });
        store.tx(() => {
          store.recordAuctionResult(auction.id, result);
          store.queueRefunds(auction.id, result.refunds);
          store.updateRound(round.id, { status: "SETTLING" });
        });
        this.log(
          "auction",
          result.winner
            ? `${auction.id} sold for ${result.winner.priceZat / ZAT_PER_ZEC} ZEC (${result.validBidCount} sealed bids)`
            : `${auction.id}: no valid bids, piece stays with the artist`,
          tip,
        );
      }
      return;
    }

    if (round.status === "SETTLING") {
      const auction = store.auctionForRound(round.id)!;
      const report = await settleAuction(store, this.d.wallet, auction.id, { batchSize: config.refundBatchSize, refundFeeZat: config.refundFeeZat });
      for (const s of report.sent) this.log("refund", `sent ${s.count} refund(s) in tx ${s.txid.slice(0, 12)}…`, tip);
      for (const f of report.failed) this.log("error", `refund batch failed (${f.count}): ${f.error}`, tip);
      if (report.done) {
        store.tx(() => {
          store.setAuctionStatus(auction.id, "SETTLED");
          store.updateRound(round.id, { status: "SETTLED" });
        });
        this.log("round", `${round.id} settled`, tip);
      }
    }
  }

  private async maybeOpenRound(tip: number, previous: RoundRow | null): Promise<void> {
    const { store, config } = this.d;
    const s = this.survival();
    if (s.state === "dormant") {
      // One dormant journal entry per dormancy, not one per block.
      if (store.getMeta("dormant_since") === null) {
        store.setMeta("dormant_since", String(tip));
        const reflection = await this.d.brain.reflect(this.context(previous, makeRoundId((previous?.number ?? 0) + 1), s));
        store.addJournal({ roundId: null, survivalState: "dormant", title: reflection.journal_title, body: reflection.journal_body, whispers: [] });
        this.log("dormant", `treasury ${s.treasuryZat / ZAT_PER_ZEC} ZEC is below the cost of a round; resting`, tip);
      }
      return;
    }
    store.db.prepare("DELETE FROM meta WHERE key = 'dormant_since'").run();
    await this.openRound(tip, previous, s);
  }

  context(previous: RoundRow | null, nextRoundId: string, s: Survival & { treasuryZat: number }): ReflectContext {
    const { store, config } = this.d;
    let lastRound: ReflectContext["lastRound"] = null;
    const notes: string[] = [];
    const whispers: { text: string; zec: number }[] = [];
    if (previous?.tally) {
      const cands = store.candidates(previous.id);
      const title = (id: string | null) => cands.find((c) => c.candidateId === id)?.title ?? null;
      const auction = store.auctionForRound(previous.id);
      lastRound = {
        roundId: previous.id,
        theme: previous.theme,
        winnerTitle: title(previous.winner),
        winnerConcept: cands.find((c) => c.candidateId === previous.winner)?.concept ?? null,
        totals: previous.tally.totals.map((t) => ({ title: title(t.candidateId) ?? t.candidateId, zec: t.totalZat / ZAT_PER_ZEC, votes: t.votes })),
        salePriceZec: auction?.priceZat != null ? auction.priceZat / ZAT_PER_ZEC : null,
        validBids: auction?.validBidCount ?? null,
      };
      for (const v of previous.tally.votes) if (v.publicNote) notes.push(v.publicNote);
      for (const w of previous.tally.whispers) whispers.push({ text: w.text, zec: w.note.valueZat / ZAT_PER_ZEC });
    }
    return {
      roundId: nextRoundId,
      survival: { state: s.state, runwayDays: s.runwayDays, treasuryZec: s.treasuryZat / ZAT_PER_ZEC },
      bounds: config.bounds,
      lastRound,
      patronNotes: notes.slice(0, 12),
      whispers: whispers.slice(0, 5),
      recentThemes: store
        .listRounds()
        .slice(0, 5)
        .map((r) => r.theme)
        .filter((t): t is string => !!t),
    };
  }

  private async openRound(tip: number, previous: RoundRow | null, s: Survival & { treasuryZat: number }): Promise<void> {
    const { store, config, wallet, brain, images } = this.d;
    const number = (previous?.number ?? 0) + 1;
    const id = makeRoundId(number);
    const ctx = this.context(previous, id, s);
    const reflection = await brain.reflect(ctx);

    // Hard bounds: whatever the brain proposed is clamped here.
    const decision = clampDecision(
      { pieces: reflection.proposed_pieces, reserveZat: Math.round(reflection.proposed_reserve_zec * ZAT_PER_ZEC) },
      config.bounds,
      s.state,
    );
    const pieces = reflection.pieces.slice(0, decision.pieces);
    if (pieces.length < config.bounds.piecesMin) throw new Error(`brain returned ${pieces.length} pieces, need ≥ ${config.bounds.piecesMin}`);

    const dir = join(config.generatedDir, id);
    mkdirSync(dir, { recursive: true });
    const rendered: { cid: (typeof CANDIDATE_IDS)[number]; p: (typeof pieces)[number]; file: string; sha: string; mime: string }[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!;
      const cid = CANDIDATE_IDS[i]!;
      const img = await images.generate({ seed: `${id}:${cid}:${p.title}`, motif: p.motif, palette: p.palette, survival: s.state, title: p.title, concept: p.concept });
      const file = `${id}/${cid}.${img.ext}`;
      writeFileSync(join(config.generatedDir, file), img.bytes);
      rendered.push({ cid, p, file, sha: sha256Hex(img.bytes), mime: img.mime });
    }

    const { address, diversifierIndex } = await wallet.newAddress("voting");
    store.tx(() => {
      store.addAddress({ address, account: "voting", kind: "round", refId: id, diversifierIndex });
      store.insertRound({
        id,
        number,
        status: "OPEN_VOTING",
        theme: reflection.theme,
        address,
        openHeight: tip + 1,
        closeHeight: tip + config.votingBlocks,
        survivalState: s.state,
        pieces: rendered.length,
        reserveZat: decision.reserveZat,
      });
      for (const r of rendered)
        store.insertCandidate({ roundId: id, candidateId: r.cid, title: r.p.title, concept: r.p.concept, imageFile: r.file, imageSha256: r.sha, mime: r.mime });
      store.addJournal({
        roundId: id,
        survivalState: s.state,
        title: reflection.journal_title,
        body: reflection.journal_body,
        whispers: ctx.whispers.map((w) => ({ text: w.text, used: reflection.whispers_used.includes(w.text) })),
      });
      store.addSpending(config.roundCostZat, `compute ${id} (${brain.name}, ${images.name})`);
    });
    this.log("round", `${id} open: ${rendered.length} pieces on "${reflection.theme}", voting until block ${tip + config.votingBlocks}`, tip);
  }

  private async closeVoting(round: RoundRow, tip: number): Promise<void> {
    const { store, config } = this.d;
    const tally = tallyRound(store.notesFor(round.address), {
      roundId: round.id,
      candidateIds: store.candidates(round.id).map((c) => c.candidateId),
      openHeight: round.openHeight,
      closeHeight: round.closeHeight,
      minVoteZat: config.minVoteZat,
      minWhisperZat: config.minWhisperZat,
      network: config.network,
    });
    store.updateRound(round.id, { status: "TALLIED", winner: tally.winner, tally });
    this.log("tally", `${round.id}: ${tally.votes.length} votes, winner ${tally.winner ?? "none"}`, tip);
  }

  private async openAuctionOrFinish(round: RoundRow, tip: number): Promise<void> {
    const { store, config, wallet } = this.d;
    if (!round.winner || round.reserveZat <= 0) {
      store.updateRound(round.id, { status: "SETTLED" });
      this.log("round", `${round.id}: no winner, nothing to auction`, tip);
      return;
    }
    const id = makeAuctionId(round.number);
    const { address, diversifierIndex } = await wallet.newAddress("auction");
    store.tx(() => {
      store.addAddress({ address, account: "auction", kind: "auction", refId: id, diversifierIndex });
      store.insertAuction({
        id,
        roundId: round.id,
        candidateId: round.winner!,
        address,
        openHeight: tip + 1,
        closeHeight: tip + config.auctionBlocks,
        reserveZat: round.reserveZat,
      });
      store.updateRound(round.id, { status: "AUCTION_OPEN" });
    });
    this.log("auction", `${id} open for ${pieceId(round.id, round.winner)}, reserve ${round.reserveZat / ZAT_PER_ZEC} ZEC, until block ${tip + config.auctionBlocks}`, tip);
  }
}
