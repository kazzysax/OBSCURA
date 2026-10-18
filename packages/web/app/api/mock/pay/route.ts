import { NextResponse } from "next/server";
import { byteLength, MEMO_MAX_BYTES } from "@obscura/core";
import { ctx } from "@/lib/server";

/** Mock chain only: simulate a shielded payment from a wallet. Disabled on a real chain. */
export async function POST(req: Request) {
  const { mock, store } = ctx();
  if (!mock) return NextResponse.json({ error: "mock chain is disabled" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { address?: string; valueZat?: number; memo?: string };
  if (typeof b.address !== "string" || !store.addressInfo(b.address)) return NextResponse.json({ error: "unknown address" }, { status: 400 });
  if (!Number.isSafeInteger(b.valueZat) || (b.valueZat as number) <= 0 || (b.valueZat as number) > 21e14) {
    return NextResponse.json({ error: "valueZat must be a positive integer" }, { status: 400 });
  }
  if (b.memo != null && (typeof b.memo !== "string" || byteLength(b.memo) > MEMO_MAX_BYTES)) {
    return NextResponse.json({ error: "memo must be ≤ 512 bytes" }, { status: 400 });
  }
  return NextResponse.json(mock.pay({ toAddress: b.address, valueZat: b.valueZat as number, memo: b.memo ?? null }));
}
