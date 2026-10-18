// Wires config → store, chain, brain, images, orchestrator. Used by the CLI and tests.
import { loadConfig, ZAT_PER_ZEC, type ChainSource, type ObscuraConfig, type Wallet } from "@obscura/core";
import { Detector, SidecarClient } from "@obscura/detector";
import { MockChain, simulateBids, simulateVotes, simulateWhispers, type SimulatedBidder, type SimulatedPatronKey } from "@obscura/mock";
import { Store } from "@obscura/store";
import { ClaudeBrain, ResilientBrain, type ArtistBrain } from "./brain.ts";
import { Orchestrator, type Event } from "./orchestrator.ts";
import { SvgGenerator, type ImageGenerator } from "./render.ts";

export interface Runtime {
  config: ObscuraConfig;
  store: Store;
  chain: ChainSource & Wallet;
  mock: MockChain | null;
  detector: Detector;
  brain: ArtistBrain;
  images: ImageGenerator;
  orchestrator: Orchestrator;
  /** One tick: scan the chain, then advance the round state machine. */
  tick(): Promise<number>;
}

export function createRuntime(opts: { config?: ObscuraConfig; brain?: ArtistBrain; log?: (e: Event) => void } = {}): Runtime {
  const config = opts.config ?? loadConfig();
  const store = new Store(config.dbPath);
  const mock = config.useMockChain ? new MockChain(store, config.network) : null;
  const chain: ChainSource & Wallet = mock ?? new SidecarClient(config.sidecarUrl);
  const detector = new Detector(chain, store);
  const brain =
    opts.brain ?? new ResilientBrain(config.anthropicApiKey ? new ClaudeBrain(config.anthropicApiKey, config.anthropicModel) : null);
  const images = new SvgGenerator();
  const orchestrator = new Orchestrator({ store, wallet: chain, brain, images, config, log: opts.log });
  return {
    config,
    store,
    chain,
    mock,
    detector,
    brain,
    images,
    orchestrator,
    async tick() {
      const { tip } = await detector.poll();
      await orchestrator.step(tip);
      // A step may open a round or auction; poll again so the store reflects the newest addresses.
      await detector.poll();
      return tip;
    },
  };
}

/** Keys held by simulated patrons and bidders, so demos can claim and collect badges. */
export interface SimKeys {
  patrons: SimulatedPatronKey[];
  bidders: (SimulatedBidder & { auctionId: string })[];
}

/** Simulated patron activity for one mock block (demo autopilot). */
export function autopilot(rt: Runtime, seed: number, keys?: SimKeys): void {
  const { store, mock, config } = rt;
  if (!mock) return;
  const round = store.latestRound();
  if (!round) return;
  const tip = mock.tip();
  if (round.status === "OPEN_VOTING" && tip < round.closeHeight) {
    const patrons = simulateVotes(mock, {
      roundId: round.id,
      address: round.address,
      candidateIds: store.candidates(round.id).map((c) => c.candidateId),
      count: 1 + (seed % 3),
      seed,
      minVoteZat: config.minVoteZat,
    });
    keys?.patrons.push(...patrons);
    if (seed % 7 === 0) simulateWhispers(mock, { roundId: round.id, address: round.address, count: 1, seed, minWhisperZat: config.minWhisperZat });
  }
  const auction = store.auctionForRound(round.id);
  if (round.status === "AUCTION_OPEN" && auction && tip < auction.closeHeight && seed % 2 === 0) {
    const bidders = simulateBids(mock, { auctionId: auction.id, address: auction.address, reserveZat: auction.reserveZat, count: 1, seed, network: config.network });
    keys?.bidders.push(...bidders.map((b) => ({ ...b, auctionId: auction.id })));
  }
}

export function zec(zat: number): string {
  return (zat / ZAT_PER_ZEC).toFixed(4) + " ZEC";
}
