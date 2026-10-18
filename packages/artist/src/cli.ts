// obscura CLI: `run` (the live loop), `demo` (a full simulated round on the mock chain), `status`,
// `refunds-retry <auction_id>`.
import { rmSync } from "node:fs";
import {
  loadConfig,
  signMessage,
  verifyCertificate,
  ZAT_PER_ZEC,
} from "@obscura/core";
import { treasuryZat } from "@obscura/store";
import { issueChallenge, loadOrCreateArtistKey, redeemBadge, redeemClaim, retryFailedRefunds } from "@obscura/settlement";
import { autopilot, createRuntime, zec, type SimKeys } from "./runtime.ts";
import type { Event } from "./orchestrator.ts";

const log = (e: Event) => console.log(`[block ${e.at}] ${e.kind.padEnd(8)} ${e.message}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  const rt = createRuntime({ log });
  const key = loadOrCreateArtistKey(rt.config.artistKeyPath);
  const donation = await rt.orchestrator.ensureDonationAddress();
  console.log(`obscura: network=${rt.config.network} chain=${rt.mock ? "mock" : "sidecar"} brain=${rt.brain.name}`);
  console.log(`artist public key: ${key.publicKey}`);
  console.log(`donation address:  ${donation}`);
  const blockMs = Number(process.env.MOCK_BLOCK_SECONDS ?? "5") * 1000;
  const pilot = process.env.MOCK_AUTOPILOT === "true";
  let seed = 1;
  for (;;) {
    try {
      if (rt.mock) {
        if (pilot) autopilot(rt, seed++);
        rt.mock.mine(1);
      }
      await rt.tick();
    } catch (e) {
      console.error("tick failed:", e instanceof Error ? e.message : e);
    }
    await sleep(rt.mock ? blockMs : 15_000);
  }
}

/** A complete round on the mock chain, start to finish, with a claim and a badge at the end. */
async function demo(): Promise<void> {
  const dbPath = process.env.OBSCURA_DB ?? "./data/demo.sqlite";
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
  const config = loadConfig({ ...process.env, OBSCURA_DB: dbPath, USE_MOCK_CHAIN: "true", VOTING_BLOCKS: "12", AUCTION_BLOCKS: "8" });
  const rt = createRuntime({ config, log });
  const mock = rt.mock!;
  const artist = loadOrCreateArtistKey(config.artistKeyPath);
  const rounds = Number(process.env.DEMO_ROUNDS ?? "2");

  const donation = await rt.orchestrator.ensureDonationAddress();
  mock.pay({ toAddress: donation, valueZat: 20 * ZAT_PER_ZEC, memo: "founding patron" });
  console.log(`founding donation of 20 ZEC sent to ${donation.slice(0, 24)}…`);

  const keys: SimKeys = { patrons: [], bidders: [] };
  let seed = 7;
  for (let guard = 0; guard < 400; guard++) {
    const done = rt.store.listRounds().filter((r) => r.status === "SETTLED").length;
    if (done >= rounds) break;
    autopilot(rt, seed++, keys);
    mock.mine(1);
    await rt.tick();
  }

  const last = rt.store.listRounds().find((r) => r.status === "SETTLED" && rt.store.auctionForRound(r.id)?.winnerClaimPubkey);
  console.log("\n=== Summary ===");
  for (const r of [...rt.store.listRounds()].reverse()) {
    const a = rt.store.auctionForRound(r.id);
    const c = rt.store.candidates(r.id);
    console.log(
      `${r.id} [${r.survivalState}] "${r.theme}" — ${r.tally?.votes.length ?? 0} votes, winner ${r.winner ? `${r.winner} "${c.find((x) => x.candidateId === r.winner)?.title}"` : "none"}` +
        (a ? `; ${a.id} ${a.priceZat != null ? `sold for ${zec(a.priceZat)} (${a.validBidCount} bids)` : "unsold"}` : ""),
    );
  }
  const refunds = rt.store.refunds();
  console.log(`refunds sent: ${refunds.filter((r) => r.status === "sent").length}/${refunds.length}`);
  console.log(`treasury: ${zec(treasuryZat(rt.store))}, state ${rt.orchestrator.survival().state}`);

  if (last) {
    const a = rt.store.auctionForRound(last.id)!;
    const winner = keys.bidders.find((b) => b.auctionId === a.id && b.publicKey === a.winnerClaimPubkey)!;
    const ch = issueChallenge(rt.store, "claim", a.id);
    const claim = redeemClaim(rt.store, artist.privateKey, { auctionId: a.id, nonce: ch.nonce, signature: signMessage(ch.challenge, winner.privateKey) });
    console.log(`\nwinner claimed ${claim.certificate.piece_id}: certificate valid = ${verifyCertificate(claim.certificate, artist.publicKey)}`);
    const loser = keys.bidders.find((b) => b.auctionId === a.id && b.publicKey !== a.winnerClaimPubkey);
    if (loser) {
      const ch2 = issueChallenge(rt.store, "claim", a.id);
      try {
        redeemClaim(rt.store, artist.privateKey, { auctionId: a.id, nonce: ch2.nonce, signature: signMessage(ch2.challenge, loser.privateKey) });
      } catch (e) {
        console.log(`a losing bidder's claim is refused: ${(e as Error).message}`);
      }
      const back = mock.receivedBy(loser.refundUa).reduce((s, x) => s + x.valueZat, 0);
      console.log(`losing bidder bid ${zec(loser.valueZat)} and got ${zec(back)} back`);
    }
    const patron = keys.patrons.find((p) => p.roundId === last.id && p.candidateId === last.winner);
    if (patron) {
      const bc = issueChallenge(rt.store, "badge", last.id);
      const badge = redeemBadge(rt.store, artist.privateKey, {
        roundId: last.id,
        patronPubkey: patron.publicKey,
        nonce: bc.nonce,
        signature: signMessage(bc.challenge, patron.privateKey),
      });
      console.log(`patron badge: backed ${badge.candidate_id} in ${badge.round_id}, won=${badge.won}, valid=${verifyCertificate(badge, artist.publicKey)}`);
    }
  }
  console.log(`\nweb: OBSCURA_DB=${dbPath} pnpm web`);
}

async function status(): Promise<void> {
  const rt = createRuntime();
  const s = rt.orchestrator.survival();
  console.log(`treasury ${zec(s.treasuryZat)}, runway ${s.runwayDays.toFixed(1)} days, state ${s.state}`);
  for (const r of rt.store.listRounds().slice(0, 5)) console.log(`${r.id} ${r.status} blocks ${r.openHeight}–${r.closeHeight} winner ${r.winner ?? "-"}`);
  const stuck = rt.store.refunds().filter((r) => r.status !== "sent");
  if (stuck.length) console.log(`refunds not sent: ${stuck.map((r) => `${r.auctionId}:${r.status}`).join(", ")}`);
}

const [cmd, arg] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  run,
  demo,
  status,
  "refunds-retry": async () => {
    if (!arg) throw new Error("usage: refunds-retry <auction_id>");
    console.log(`re-queued ${retryFailedRefunds(createRuntime().store, arg)} refund(s)`);
  },
};

const fn = commands[cmd ?? ""];
if (!fn) {
  console.log("usage: obscura <run|demo|status|refunds-retry>");
  process.exit(1);
}
fn().catch((e) => {
  console.error(e);
  process.exit(1);
});
