import { describe, expect, it } from "vitest";
import { encodeBid, encodeVote, encodeWhisper, filterPublicText, MEMO_MAX_BYTES, parseMemo } from "./memo.ts";
import { fakeOrchardUa } from "./testutil.ts";
import { buildPaymentUri, formatZec, parsePaymentUri, parseZec } from "./zip321.ts";

const PK = "ab".repeat(32);
const UA = fakeOrchardUa("bidder", "testnet");

describe("vote memos", () => {
  it("round-trips the short form", () => {
    const m = encodeVote({ roundId: "r0007", candidateId: "a" });
    expect(m).toBe("obscura:v0:v:r0007:a");
    expect(parseMemo(m, "testnet")).toEqual({ kind: "vote", roundId: "r0007", candidateId: "a", patronPubkey: null, note: null });
  });

  it("round-trips pubkey + note, note may contain colons", () => {
    const m = encodeVote({ roundId: "r0007", candidateId: "b", patronPubkey: PK, note: "love it: really" });
    expect(parseMemo(m, "testnet")).toMatchObject({ patronPubkey: PK, note: "love it: really" });
  });

  it("accepts a note without pubkey (empty field) and a bare note", () => {
    expect(parseMemo("obscura:v0:v:r0007:b::love the blue", "testnet")).toMatchObject({ patronPubkey: null, note: "love the blue" });
    expect(parseMemo("obscura:v0:v:r0007:b:love the blue", "testnet")).toMatchObject({ patronPubkey: null, note: "love the blue" });
  });

  it("strips ZIP-302 zero padding", () => {
    expect(parseMemo("obscura:v0:v:r0007:c\0\0\0", "testnet")).toMatchObject({ kind: "vote", candidateId: "c" });
  });

  it("rejects unknown candidates and bad ids", () => {
    expect(parseMemo("obscura:v0:v:r0007:z", "testnet").kind).toBe("invalid");
    expect(parseMemo("obscura:v0:v:round7:a", "testnet").kind).toBe("invalid");
    expect(parseMemo("hello", "testnet").kind).toBe("invalid");
    expect(parseMemo(null, "testnet").kind).toBe("invalid");
  });

  it("enforces the 512-byte limit", () => {
    expect(() => encodeVote({ roundId: "r0007", candidateId: "a", note: "x".repeat(MEMO_MAX_BYTES) })).toThrow();
  });
});

describe("whisper memos", () => {
  it("round-trips", () => {
    const m = encodeWhisper({ roundId: "r0007", text: "lighthouses in fog" });
    expect(parseMemo(m, "testnet")).toEqual({ kind: "whisper", roundId: "r0007", text: "lighthouses in fog" });
  });
});

describe("bid memos", () => {
  it("round-trips and stays well under 512 bytes", () => {
    const m = encodeBid({ auctionId: "a0007", claimPubkey: PK, refundUa: UA });
    expect(new TextEncoder().encode(m).length).toBeLessThan(250);
    expect(parseMemo(m, "testnet")).toEqual({ kind: "bid", auctionId: "a0007", claimPubkey: PK, refundUa: UA });
  });

  it("salvages a refund address from a malformed bid", () => {
    expect(parseMemo(`obscura:v0:b:a0007:nothex:${UA}`, "testnet")).toEqual({ kind: "bad_bid", refundUa: UA, auctionId: "a0007" });
  });

  it("rejects refund addresses on the wrong network", () => {
    expect(parseMemo(`obscura:v0:b:a0007:${PK}:${UA}`, "mainnet").kind).toBe("invalid");
  });
});

describe("public text filter", () => {
  it("cleans and clamps", () => {
    expect(filterPublicText("  paint\nthe sea  ")).toBe("paint the sea");
    expect(filterPublicText("x".repeat(400))!.length).toBe(280);
  });
  it("drops blocked words, links and addresses", () => {
    expect(filterPublicText("this is shit")).toBeNull();
    expect(filterPublicText("visit https://scam.example")).toBeNull();
    expect(filterPublicText(`send to ${UA}`)).toBeNull();
  });
});

describe("ZIP-321", () => {
  it("formats amounts", () => {
    expect(formatZec(100_000_000)).toBe("1");
    expect(formatZec(5_000_000)).toBe("0.05");
    expect(formatZec(1)).toBe("0.00000001");
    expect(parseZec("0.05")).toBe(5_000_000);
  });

  it("builds a URI with a base64url memo and parses it back", () => {
    const memo = "obscura:v0:v:r0007:a";
    const uri = buildPaymentUri({ address: UA, amountZat: 1_000_000, memo, label: "Obscura r0007 (a)" });
    expect(uri).toMatch(/^zcash:utest1[0-9a-z]+\?amount=0\.01&memo=[A-Za-z0-9_-]+&label=/);
    expect(uri).not.toContain("=&");
    expect(parsePaymentUri(uri)).toEqual({ address: UA, amountZat: 1_000_000, memo, label: "Obscura r0007 (a)" });
  });
});
