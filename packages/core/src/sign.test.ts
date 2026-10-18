import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  challengeString,
  generateKeyPair,
  signCertificate,
  signMessage,
  verifyCertificate,
  verifyMessage,
  type ProvenanceCertificate,
} from "./sign.ts";
import { clampDecision, defaultDecision, survival } from "./survival.ts";

describe("canonical JSON", () => {
  it("sorts keys and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: "x", c: [true, null] })).toBe('{"a":"x","b":1,"c":[true,null]}');
  });
  it("rejects floats", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
  });
});

describe("certificates", () => {
  const artist = generateKeyPair();
  const body = {
    type: "obscura.provenance.v0" as const,
    piece_id: "r0007-a",
    round_id: "r0007",
    auction_id: "a0007",
    price_zat: 50_000_000,
    claim_pubkey: "11".repeat(32),
    image_sha256: "22".repeat(32),
  };

  it("signs and verifies regardless of key order", () => {
    const cert = signCertificate<ProvenanceCertificate>(body, artist.privateKey);
    expect(verifyCertificate(cert, artist.publicKey)).toBe(true);
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(cert).reverse())));
    expect(verifyCertificate(reordered, artist.publicKey)).toBe(true);
  });

  it("fails if any field changes or the key is wrong", () => {
    const cert = signCertificate<ProvenanceCertificate>(body, artist.privateKey);
    expect(verifyCertificate({ ...cert, price_zat: 1 }, artist.publicKey)).toBe(false);
    expect(verifyCertificate(cert, generateKeyPair().publicKey)).toBe(false);
  });
});

describe("challenges", () => {
  it("only the matching key verifies, and kinds don't cross over", () => {
    const k = generateKeyPair();
    const claim = challengeString("claim", "a0007", "00".repeat(16));
    const sig = signMessage(claim, k.privateKey);
    expect(verifyMessage(claim, sig, k.publicKey)).toBe(true);
    expect(verifyMessage(challengeString("badge", "a0007", "00".repeat(16)), sig, k.publicKey)).toBe(false);
    expect(verifyMessage(claim, sig, generateKeyPair().publicKey)).toBe(false);
    expect(verifyMessage(claim, "zz", k.publicKey)).toBe(false);
  });
});

describe("survival", () => {
  const base = { dailySpendZat: 500_000, roundCostZat: 500_000 };
  it("maps runway to states", () => {
    expect(survival({ ...base, treasuryZat: 2_000_000_000 }).state).toBe("thriving");
    expect(survival({ ...base, treasuryZat: 5_000_000 }).state).toBe("steady");
    expect(survival({ ...base, treasuryZat: 1_000_000 }).state).toBe("struggling");
    expect(survival({ ...base, treasuryZat: 100_000 }).state).toBe("dormant");
  });

  const bounds = { piecesMin: 2, piecesMax: 6, reserveMinZat: 1_000_000, reserveMaxZat: 100_000_000 };
  it("clamps agent proposals into hard bounds", () => {
    expect(clampDecision({ pieces: 99, reserveZat: 1e12 }, bounds, "thriving")).toEqual({ pieces: 6, reserveZat: 100_000_000 });
    expect(clampDecision({ pieces: "lots", reserveZat: -5 }, bounds, "steady")).toEqual({ pieces: 2, reserveZat: 1_000_000 });
    expect(clampDecision({ pieces: 4, reserveZat: 5_000_000 }, bounds, "dormant")).toEqual({ pieces: 0, reserveZat: 0 });
  });
  it("defaults scale with state", () => {
    expect(defaultDecision("thriving", bounds).pieces).toBe(6);
    expect(defaultDecision("struggling", bounds).pieces).toBe(2);
  });
});
