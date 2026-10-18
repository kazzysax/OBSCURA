// Server-side access to the shared SQLite store. Never imported by client components.
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { loadConfig, survival, tallyRound, type ObscuraConfig } from "@obscura/core";
import { MockChain } from "@obscura/mock";
import { loadOrCreateArtistKey } from "@obscura/settlement";
import { Store, treasuryZat } from "@obscura/store";
import type { AppState, CandidateView } from "./view";

/** The repo root: the web app runs from packages/web. */
const ROOT = resolve(process.cwd(), process.cwd().endsWith("packages/web") ? "../.." : ".");

function loadDotEnv(): Record<string, string> {
  const file = resolve(ROOT, ".env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

const fromRoot = (p: string) => (isAbsolute(p) ? p : resolve(ROOT, p));

type Ctx = { config: ObscuraConfig; store: Store; mock: MockChain | null; artist: { publicKey: string; privateKey: string } };
const g = globalThis as unknown as { __obscura?: Ctx };

export function ctx(): Ctx {
  if (g.__obscura) return g.__obscura;
  const env = { ...loadDotEnv(), ...process.env } as Record<string, string | undefined>;
  const base = loadConfig(env);
  const config: ObscuraConfig = {
    ...base,
    dbPath: fromRoot(env.OBSCURA_DB ?? "./data/obscura.sqlite"),
    generatedDir: fromRoot(base.generatedDir),
    artistKeyPath: fromRoot(base.artistKeyPath),
  };
  const store = new Store(config.dbPath);
  const mock = config.useMockChain ? new MockChain(store, config.network) : null;
  g.__obscura = { config, store, mock, artist: loadOrCreateArtistKey(config.artistKeyPath) };
  return g.__obscura;
}

export function imageUrl(file: string): string {
  return `/api/image/${file}`;
}

export function appState(): AppState {
  const { config, store, mock, artist } = ctx();
  const tip = Number(store.getMeta("chain_tip") ?? "0");
  const t = treasuryZat(store);
  const s = survival({ treasuryZat: t, dailySpendZat: config.dailySpendZat, roundCostZat: config.roundCostZat });

  const r = store.latestRound();
  let round: AppState["round"] = null;
  if (r) {
    const cands = store.candidates(r.id);
    // Live totals are public by design; recompute from the notes seen so far.
    const live =
      r.tally ??
      tallyRound(store.notesFor(r.address), {
        roundId: r.id,
        candidateIds: cands.map((c) => c.candidateId),
        openHeight: r.openHeight,
        closeHeight: r.closeHeight,
        minVoteZat: config.minVoteZat,
        minWhisperZat: config.minWhisperZat,
        network: config.network,
      });
    const candidates: CandidateView[] = cands.map((c) => {
      const tot = live.totals.find((x) => x.candidateId === c.candidateId);
      return { id: c.candidateId, title: c.title, concept: c.concept, image: imageUrl(c.imageFile), totalZat: tot?.totalZat ?? 0, votes: tot?.votes ?? 0 };
    });
    round = {
      id: r.id,
      status: r.status,
      theme: r.theme,
      address: r.address,
      openHeight: r.openHeight,
      closeHeight: r.closeHeight,
      reserveZat: r.reserveZat,
      survivalState: r.survivalState,
      winner: r.winner,
      candidates,
      notes: live.votes.map((v) => v.publicNote).filter((n): n is string => !!n).slice(-8).reverse(),
      whispers: live.whispers.map((w) => w.text).slice(0, 5),
      voteCount: live.votes.length,
      badgeCount: Object.values(live.badgeRegistry).reduce((n, k) => n + k.length, 0),
    };
  }

  const a = r ? store.auctionForRound(r.id) : null;
  const auctionCand = a ? store.candidates(a.roundId).find((c) => c.candidateId === a.candidateId) : null;
  const auction: AppState["auction"] =
    a && auctionCand
      ? {
          id: a.id,
          roundId: a.roundId,
          candidateId: a.candidateId,
          title: auctionCand.title,
          concept: auctionCand.concept,
          image: imageUrl(auctionCand.imageFile),
          address: a.address,
          openHeight: a.openHeight,
          closeHeight: a.closeHeight,
          reserveZat: a.reserveZat,
          status: a.status,
          priceZat: a.priceZat,
          validBidCount: a.validBidCount,
          bidsReceived: a.status === "OPEN" ? store.notesFor(a.address).length : null,
        }
      : null;

  return {
    network: config.network,
    mock: !!mock,
    tip,
    artistPubkey: artist.publicKey,
    donationAddress: store.getMeta("donation_address"),
    survival: { state: s.state, runwayDays: Number.isFinite(s.runwayDays) ? s.runwayDays : null, treasuryZat: t },
    minVoteZat: config.minVoteZat,
    minWhisperZat: config.minWhisperZat,
    round,
    auction,
  };
}
