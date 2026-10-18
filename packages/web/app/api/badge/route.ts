import { NextResponse } from "next/server";
import { ClaimError, redeemBadge } from "@obscura/settlement";
import { ctx } from "@/lib/server";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { roundId?: string; patronPubkey?: string; nonce?: string; signature?: string };
  if (![b.roundId, b.patronPubkey, b.nonce, b.signature].every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "roundId, patronPubkey, nonce and signature are required" }, { status: 400 });
  }
  const { store, artist } = ctx();
  try {
    return NextResponse.json({ badge: redeemBadge(store, artist.privateKey, b as Required<typeof b>) });
  } catch (e) {
    const status = e instanceof ClaimError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
