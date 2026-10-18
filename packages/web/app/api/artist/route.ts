import { NextResponse } from "next/server";
import { ctx } from "@/lib/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ publicKey: ctx().artist.publicKey, network: ctx().config.network });
}
