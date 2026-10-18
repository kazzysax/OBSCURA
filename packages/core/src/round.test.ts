// The worked example from the design discussion, as a test (docs/PROTOCOL.md §1, §3).
import { describe, expect, it } from "vitest";
import { clearAuction } from "./auction.ts";
import { encodeBid, encodeVote, encodeWhisper } from "./memo.ts";
import { tallyRound } from "./tally.ts";
import { fakeOrchardUa, note } from "./testutil.ts";

const PK = (c: string) => c.repeat(64);

describe("tally: round r0007", () => {
  const rules = {
    roundId: "r0007",
    candidateIds: ["a", "b", "c", "d"] as const,
    openHeight: 1000,
    closeHeight: 1048,
    minVoteZat: 100_000,
    minWhisperZat: 100_000,
    network: "testnet" as const,
  };
  const v = (c: "a" | "b" | "c" | "d" | "z", extra?: { patronPubkey?: string; note?: string }) =>
    c === "z" ? "obscura:v0:v:r0007:f" : encodeVote({ roundId: "r0007", candidateId: c, ...extra });

  const notes = [
    note({ height: 1000, valueZat: 5_000_000, memo: v("a") }),
    note({ height: 1001, valueZat: 2_000_000, memo: v("b", { patronPubkey: PK("1") }) }),
    note({ height: 1003, valueZat: 4_000_000, memo: v("b", { note: "love the blue" }) }),
    note({ height: 1004, valueZat: 5_000, memo: v("c") }),
    note({ height: 1004, valueZat: 1_000_000, memo: v("a") }),
    note({ height: 1010, valueZat: 300_000, memo: v("z") }),
    note({ height: 1050, valueZat: 900_000, memo: v("d") }),
    note({ height: 1020, valueZat: 5_000_000, memo: encodeWhisper({ roundId: "r0007", text: "lighthouses in fog" }) }),
    note({ height: 1021, valueZat: 200_000, memo: "gm", pool: "sapling" }),
  ];
  const r = tallyRound(notes, rules);

  it("breaks the a/b tie by earliest first vote", () => {
    expect(r.totals.find((t) => t.candidateId === "a")!.totalZat).toBe(6_000_000);
    expect(r.totals.find((t) => t.candidateId === "b")!.totalZat).toBe(6_000_000);
    expect(r.winner).toBe("a");
  });

  it("classifies donations", () => {
    expect(r.donations.map((d) => d.reason).sort()).toEqual(["below_min_vote", "late", "non_orchard", "unknown_candidate"]);
  });

  it("collects badges, notes and whispers", () => {
    expect(r.badgeRegistry.b).toEqual([PK("1")]);
    expect(r.badgeRegistry.a).toEqual([]);
    expect(r.votes.find((x) => x.publicNote)?.publicNote).toBe("love the blue");
    expect(r.whispers.map((w) => w.text)).toEqual(["lighthouses in fog"]);
  });

  it("is independent of input order", () => {
    const shuffled = [...notes].reverse();
    expect(tallyRound(shuffled, rules)).toEqual(r);
  });

  it("breaks same-block ties by txid then output index", () => {
    const same = [
      note({ height: 1000, txid: "bb".repeat(32), valueZat: 1_000_000, memo: v("b") }),
      note({ height: 1000, txid: "aa".repeat(32), outputIndex: 1, valueZat: 1_000_000, memo: v("c") }),
      note({ height: 1000, txid: "aa".repeat(32), outputIndex: 0, valueZat: 1_000_000, memo: v("d") }),
    ];
    expect(tallyRound(same, rules).winner).toBe("d");
  });

  it("has no winner without votes", () => {
    expect(tallyRound([], rules).winner).toBeNull();
  });
});

describe("first-price auction a0007", () => {
  const rules = { auctionId: "a0007", openHeight: 1100, closeHeight: 1148, reserveZat: 1_000_000, refundFeeZat: 10_000, network: "testnet" as const };
  const ua = (s: string) => fakeOrchardUa(s, "testnet");
  const bid = (s: string, auctionId = "a0007") => encodeBid({ auctionId, claimPubkey: PK(s), refundUa: ua(s) });

  const X = note({ height: 1101, valueZat: 50_000_000, memo: bid("1") });
  const Y = note({ height: 1102, valueZat: 30_000_000, memo: bid("2") });
  const Z = note({ height: 1103, valueZat: 500_000, memo: bid("3") });
  const W = note({ height: 1104, valueZat: 2_000_000, memo: "obscura:v0:b:garbage" });
  const L = note({ height: 1200, valueZat: 70_000_000, memo: bid("4") });
  const r = clearAuction([L, W, Z, Y, X], rules);

  it("winner pays their own bid", () => {
    expect(r.winner).toMatchObject({ claimPubkey: PK("1"), priceZat: 50_000_000 });
    expect(r.validBidCount).toBe(2);
  });

  it("refunds losers, below-reserve and late bids minus the fee", () => {
    expect(r.refunds.map((x) => [x.toUa, x.amountZat, x.reason])).toEqual([
      [ua("2"), 29_990_000, "outbid"],
      [ua("3"), 490_000, "below_reserve"],
      [ua("4"), 69_990_000, "late"],
    ]);
  });

  it("keeps unrefundable bids as donations", () => {
    expect(r.donations).toHaveLength(1);
    expect(r.donations[0]!.note).toBe(W);
  });

  it("refunds everything when nothing meets the reserve", () => {
    const none = clearAuction([Z], rules);
    expect(none.winner).toBeNull();
    expect(none.refunds).toHaveLength(1);
  });

  it("does not refund amounts at or below the fee", () => {
    const tiny = clearAuction([note({ height: 1101, valueZat: 10_000, memo: bid("5") })], rules);
    expect(tiny.refunds).toHaveLength(0);
    expect(tiny.donations[0]!.reason).toBe("below_refund_fee");
  });

  it("refunds a bid for a different auction", () => {
    const wrong = clearAuction([note({ height: 1101, valueZat: 2_000_000, memo: bid("6", "a0008") })], rules);
    expect(wrong.refunds[0]!.reason).toBe("wrong_auction");
  });

  it("ties go to the earliest bid", () => {
    const t = clearAuction(
      [note({ height: 1105, valueZat: 9_000_000, memo: bid("7") }), note({ height: 1104, valueZat: 9_000_000, memo: bid("8") })],
      rules,
    );
    expect(t.winner!.claimPubkey).toBe(PK("8"));
  });
});
