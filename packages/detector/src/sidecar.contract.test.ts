// Runs the TypeScript SidecarClient against a real sidecar process (dev backend).
// Skipped unless SIDECAR_CONTRACT_URL is set, e.g. by `pnpm test:sidecar`.
import { describe, expect, it } from "vitest";
import { SidecarClient } from "./index.ts";

const url = process.env.SIDECAR_CONTRACT_URL;

describe.skipIf(!url)("sidecar HTTP contract", () => {
  const client = new SidecarClient(url!);
  const dev = (path: string, body: unknown) =>
    fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  it("addresses, incoming notes, sends and balances", async () => {
    const a = await client.newAddress("auction");
    const b = await client.newAddress("auction");
    expect(a.address).not.toBe(b.address);

    const tip = await client.tipHeight();
    await dev("/dev/pay", { to: a.address, value_zat: 2_000_000, memo: "obscura:v0:b:a0001:x" });
    await dev("/dev/mine", { blocks: 1 });
    const notes = await client.scanIncoming(tip);
    expect(notes).toEqual([
      expect.objectContaining({ toAddress: a.address, valueZat: 2_000_000, height: tip + 1, pool: "orchard", memo: "obscura:v0:b:a0001:x" }),
    ]);

    const { txid } = await client.send("auction", [{ toUa: "utest1refund", amountZat: 1_990_000, memo: "obscura:v0:refund:a0001:outbid" }]);
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    await dev("/dev/mine", { blocks: 1 });
    expect(await client.balance("auction")).toBe(0);
    await expect(client.send("auction", [{ toUa: "utest1x", amountZat: 1 }])).rejects.toThrow(/409/);
  });
});
