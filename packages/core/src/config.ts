// Config loaded from the environment (.env.example lists every key).
import type { Network, Zat } from "./types.ts";
import type { Bounds } from "./survival.ts";

export interface ObscuraConfig {
  network: Network;
  useMockChain: boolean;
  dbPath: string;
  sidecarUrl: string;
  generatedDir: string;
  artistKeyPath: string;
  bounds: Bounds;
  minVoteZat: Zat;
  minWhisperZat: Zat;
  votingBlocks: number;
  auctionBlocks: number;
  confirmations: number;
  refundFeeZat: Zat;
  refundBatchSize: number;
  dailySpendZat: Zat;
  roundCostZat: Zat;
  anthropicApiKey: string | null;
  anthropicModel: string;
  imageProvider: string | null;
  imageApiKey: string | null;
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`config: ${key} must be an integer ≥ ${min}`);
  return n;
}

export function loadConfig(env: Env = process.env): ObscuraConfig {
  const network = (env.ZCASH_NETWORK ?? "testnet") as Network;
  if (network !== "mainnet" && network !== "testnet") throw new Error("config: ZCASH_NETWORK must be mainnet or testnet");
  const bounds: Bounds = {
    piecesMin: int(env, "PIECES_MIN", 2, 1),
    piecesMax: int(env, "PIECES_MAX", 6, 1),
    reserveMinZat: int(env, "RESERVE_MIN_ZAT", 1_000_000),
    reserveMaxZat: int(env, "RESERVE_MAX_ZAT", 100_000_000),
  };
  if (bounds.piecesMin > bounds.piecesMax || bounds.piecesMax > 8) throw new Error("config: need 1 ≤ PIECES_MIN ≤ PIECES_MAX ≤ 8");
  if (bounds.reserveMinZat > bounds.reserveMaxZat) throw new Error("config: RESERVE_MIN_ZAT > RESERVE_MAX_ZAT");
  const dailySpendZat = int(env, "DAILY_SPEND_ZAT", 500_000);
  return {
    network,
    useMockChain: (env.USE_MOCK_CHAIN ?? "true") !== "false",
    dbPath: env.OBSCURA_DB ?? "./data/obscura.sqlite",
    sidecarUrl: env.SIDECAR_URL ?? `http://127.0.0.1:${env.SIDECAR_PORT ?? "8402"}`,
    generatedDir: env.GENERATED_DIR ?? "./generated",
    artistKeyPath: env.ARTIST_SIGNING_KEY_PATH ?? "./wallet/artist.key",
    bounds,
    minVoteZat: int(env, "MIN_VOTE_ZAT", 100_000, 1),
    minWhisperZat: int(env, "MIN_WHISPER_ZAT", 100_000, 1),
    votingBlocks: int(env, "VOTING_BLOCKS", 48, 1),
    auctionBlocks: int(env, "AUCTION_BLOCKS", 48, 1),
    confirmations: int(env, "CONFIRMATIONS", 1),
    refundFeeZat: int(env, "REFUND_FEE_ZAT", 10_000),
    refundBatchSize: int(env, "REFUND_BATCH_SIZE", 5, 1),
    dailySpendZat,
    roundCostZat: int(env, "ROUND_COST_ZAT", dailySpendZat),
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    anthropicModel: env.ANTHROPIC_MODEL || "claude-opus-5-5",
    imageProvider: env.IMAGE_PROVIDER || null,
    imageApiKey: env.IMAGE_API_KEY || null,
  };
}
