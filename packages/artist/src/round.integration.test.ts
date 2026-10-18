import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeBid, encodeVote, encodeWhisper, generateKeyPair, loadConfig, signMessage, verifyCertificate, ZAT_PER_ZEC } from "@obscura/core";
import { mockRefundUa } from "@obscura/mock";
import { issueChallenge, loadOrCreateArtistKey, redeemBadge, redeemClaim } from "@obscura/settlement";
import { OfflineBrain, type ArtistBrain, type Reflection, type ReflectContext } from "./brain.ts";
import { createRuntime } from "./runtime.ts";

function setup(brain?: ArtistBrain, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "obscura-"));
  const config = loadConfig({
    OBSCURA_DB: join(dir, "db.sqlite"),
    GENERATED_DIR: join(dir, "generated"),
    ARTIST_SIGNING_KEY_PATH: join(dir, "artist.key"),
    USE_MOCK_CHAIN: "true",
    VOTING_BLOCKS: "5",
    AUCTION_BLOCKS: "5",
    ...env,
  });
  const rt = createRuntime({ config, brain });
  return { rt, mock: rt.mock!, artist: loadOrCreateArtistKey(config.artistKeyPath) };
}

async function advance(rt: ReturnType<typeof setup>["rt"], blocks: number) {
  for (let i = 0; i < blocks; i++) {
    rt.mock!.mine(1);
    await rt.tick();
  }
}

describe("a full round on the mock chain", () => {
  it("votes → tally → first-price auction → refunds → claim → badge", async () => {
    const { rt, mock, artist } = setup();
    const donation = await rt.orchestrator.ensureDonationAddress();
    mock.pay({ toAddress: donation, valueZat: 5 * ZAT_PER_ZEC });
    await advance(rt, 1);

    const round = rt.store.latestRound()!;
    expect(round.status).toBe("OPEN_VOTING");
    expect(rt.store.candidates(round.id).length).toBeGreaterThanOrEqual(2);

    const patron = generateKeyPair();
    mock.pay({ toAddress: round.address, valueZat: 3_000_000, memo: encodeVote({ roundId: round.id, candidateId: "b", patronPubkey: patron.publicKey, note: "more salt" }) });
    mock.pay({ toAddress: round.address, valueZat: 1_000_000, memo: encodeVote({ roundId: round.id, candidateId: "a" }) });
    mock.pay({ toAddress: round.address, valueZat: 500_000, memo: encodeWhisper({ roundId: round.id, text: "night trains" }) });
    await advance(rt, 6);

    const tallied = rt.store.getRound(round.id)!;
    expect(tallied.winner).toBe("b");
    expect(tallied.status).toBe("AUCTION_OPEN");

    const auction = rt.store.auctionForRound(round.id)!;
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const bobUa = mockRefundUa("bob");
    mock.pay({ toAddress: auction.address, valueZat: 40_000_000, memo: encodeBid({ auctionId: auction.id, claimPubkey: alice.publicKey, refundUa: mockRefundUa("alice") }) });
    mock.pay({ toAddress: auction.address, valueZat: 25_000_000, memo: encodeBid({ auctionId: auction.id, claimPubkey: bob.publicKey, refundUa: bobUa }) });
    await advance(rt, 8);

    const done = rt.store.getRound(round.id)!;
    expect(done.status).toBe("SETTLED");
    const a = rt.store.getAuction(auction.id)!;
    expect(a.priceZat).toBe(40_000_000);
    expect(a.validBidCount).toBe(2);
    expect(mock.receivedBy(bobUa).reduce((s, x) => s + x.valueZat, 0)).toBe(25_000_000 - rt.config.refundFeeZat);
    // Money is conserved: the auction account keeps the price; the withheld refund fee paid the network fee.
    expect(await mock.balance("auction")).toBe(40_000_000);

    const ch = issueChallenge(rt.store, "claim", a.id);
    const claim = redeemClaim(rt.store, artist.privateKey, { auctionId: a.id, nonce: ch.nonce, signature: signMessage(ch.challenge, alice.privateKey) });
    expect(verifyCertificate(claim.certificate, artist.publicKey)).toBe(true);
    expect(claim.certificate.price_zat).toBe(40_000_000);
    // Challenges are single use.
    expect(() =>
      redeemClaim(rt.store, artist.privateKey, { auctionId: a.id, nonce: ch.nonce, signature: signMessage(ch.challenge, alice.privateKey) }),
    ).toThrow(/used/);

    const bc = issueChallenge(rt.store, "badge", round.id);
    const badge = redeemBadge(rt.store, artist.privateKey, { roundId: round.id, patronPubkey: patron.publicKey, nonce: bc.nonce, signature: signMessage(bc.challenge, patron.privateKey) });
    expect(badge).toMatchObject({ candidate_id: "b", won: true });

    // The next round opens and the agent sees the whisper and the note.
    await advance(rt, 1);
    const next = rt.store.latestRound()!;
    expect(next.id).toBe("r0002");
    expect(next.theme).toBe("night trains");
  });

  it("clamps an agent that asks for too much", async () => {
    class Greedy implements ArtistBrain {
      readonly name = "greedy";
      async reflect(ctx: ReflectContext): Promise<Reflection> {
        const r = await new OfflineBrain().reflect(ctx);
        return { ...r, proposed_pieces: 50, proposed_reserve_zec: 1_000_000 };
      }
    }
    const { rt, mock } = setup(new Greedy());
    mock.pay({ toAddress: await rt.orchestrator.ensureDonationAddress(), valueZat: 5 * ZAT_PER_ZEC });
    await advance(rt, 1);
    const round = rt.store.latestRound()!;
    expect(round.pieces).toBe(rt.config.bounds.piecesMax);
    expect(round.reserveZat).toBe(rt.config.bounds.reserveMaxZat);
  });

  it("goes dormant without money and wakes up when funded", async () => {
    const { rt, mock } = setup();
    const donation = await rt.orchestrator.ensureDonationAddress();
    await advance(rt, 3);
    expect(rt.store.latestRound()).toBeNull();
    expect(rt.store.journal()[0]!.survivalState).toBe("dormant");
    expect(rt.store.journal()).toHaveLength(1); // one entry per dormancy, not per block

    mock.pay({ toAddress: donation, valueZat: ZAT_PER_ZEC });
    await advance(rt, 2);
    expect(rt.store.latestRound()?.id).toBe("r0001");
  });

  it("refunds every bid when nothing meets the reserve", async () => {
    const { rt, mock } = setup(undefined, { RESERVE_MIN_ZAT: "50000000", RESERVE_MAX_ZAT: "50000000" });
    mock.pay({ toAddress: await rt.orchestrator.ensureDonationAddress(), valueZat: 5 * ZAT_PER_ZEC });
    await advance(rt, 1);
    const round = rt.store.latestRound()!;
    mock.pay({ toAddress: round.address, valueZat: 1_000_000, memo: encodeVote({ roundId: round.id, candidateId: "a" }) });
    await advance(rt, 7);
    const auction = rt.store.auctionForRound(round.id)!;
    const ua = mockRefundUa("low");
    mock.pay({ toAddress: auction.address, valueZat: 2_000_000, memo: encodeBid({ auctionId: auction.id, claimPubkey: "ab".repeat(32), refundUa: ua }) });
    await advance(rt, 8);
    expect(rt.store.getAuction(auction.id)!.winnerClaimPubkey).toBeNull();
    expect(mock.receivedBy(ua)[0]!.valueZat).toBe(2_000_000 - rt.config.refundFeeZat);
    expect(rt.store.getRound(round.id)!.status).toBe("SETTLED");
  });
});
