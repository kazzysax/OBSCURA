import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { f4jumble, f4jumbleInv } from "./f4jumble.ts";
import { decodeUa, encodeUa, hasOrchardReceiver, isOrchardOnly, TYPECODE } from "./ua.ts";

const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const load = (name: string) =>
  (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown[][]).slice(2);

describe("f4jumble", () => {
  const vectors = load("f4jumble.json") as [string, string][];
  it.each(vectors.slice(0, 8))("matches test vector %#", (normal, jumbled) => {
    expect(Buffer.from(f4jumble(hex(normal))).toString("hex")).toBe(jumbled);
    expect(Buffer.from(f4jumbleInv(hex(jumbled))).toString("hex")).toBe(normal);
  });
});

describe("unified address", () => {
  type Row = [string | null, string | null, string | null, string | null, number | null, string | null, string];
  const vectors = load("unified_address.json") as Row[];

  it("decodes every ZIP-316 test vector to its receivers", () => {
    for (const [p2pkh, p2sh, sapling, orchard, , , ua] of vectors) {
      const dec = decodeUa(ua);
      expect(dec, ua).not.toBeNull();
      const get = (tc: number) => dec!.receivers.find((r) => r.typecode === tc)?.data;
      const toHex = (b?: Uint8Array) => (b ? Buffer.from(b).toString("hex") : null);
      expect(toHex(get(TYPECODE.p2pkh))).toBe(p2pkh);
      expect(toHex(get(TYPECODE.p2sh))).toBe(p2sh);
      expect(toHex(get(TYPECODE.sapling))).toBe(sapling);
      expect(toHex(get(TYPECODE.orchard))).toBe(orchard);
      expect(hasOrchardReceiver(ua, "mainnet")).toBe(orchard !== null);
    }
  });

  it("round-trips encode/decode", () => {
    for (const [, , , , , , ua] of vectors) {
      const dec = decodeUa(ua)!;
      expect(encodeUa(dec.network, dec.receivers)).toBe(ua);
    }
  });

  it("recognises Orchard-only addresses", () => {
    const orchardOnly = encodeUa("testnet", [{ typecode: TYPECODE.orchard, data: new Uint8Array(43).fill(7) }]);
    expect(orchardOnly.startsWith("utest1")).toBe(true);
    expect(isOrchardOnly(orchardOnly, "testnet")).toBe(true);
    expect(isOrchardOnly(orchardOnly, "mainnet")).toBe(false);
    const withSapling = vectors.find((r) => r[2] && r[3])![6];
    expect(isOrchardOnly(withSapling)).toBe(false);
  });

  it("rejects garbage and corrupted checksums", () => {
    const ua = vectors[0]![6];
    expect(decodeUa("hello")).toBeNull();
    expect(decodeUa(ua.slice(0, -1) + (ua.endsWith("q") ? "p" : "q"))).toBeNull();
    expect(decodeUa("zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly")).toBeNull();
  });
});
