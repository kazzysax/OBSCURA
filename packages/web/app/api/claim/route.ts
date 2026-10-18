import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { ClaimError, redeemClaim } from "@obscura/settlement";
import { ctx } from "@/lib/server";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { auctionId?: string; nonce?: string; signature?: string };
  if (typeof body.auctionId !== "string" || typeof body.nonce !== "string" || typeof body.signature !== "string") {
    return NextResponse.json({ error: "auctionId, nonce and signature are required" }, { status: 400 });
  }
  const { store, artist, config } = ctx();
  try {
    const result = redeemClaim(store, artist.privateKey, { auctionId: body.auctionId, nonce: body.nonce, signature: body.signature });
    const original = readFileSync(resolve(config.generatedDir, result.imageFile));
    return NextResponse.json({
      certificate: result.certificate,
      image: { mime: result.mime, base64: original.toString("base64"), filename: `${result.certificate.piece_id}.svg` },
    });
  } catch (e) {
    const status = e instanceof ClaimError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
