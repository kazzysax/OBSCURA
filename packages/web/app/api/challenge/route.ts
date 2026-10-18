import { NextResponse } from "next/server";
import { ClaimError, issueChallenge } from "@obscura/settlement";
import { ctx } from "@/lib/server";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string; id?: string };
  if ((body.kind !== "claim" && body.kind !== "badge") || typeof body.id !== "string") {
    return NextResponse.json({ error: "kind must be claim|badge and id a string" }, { status: 400 });
  }
  try {
    return NextResponse.json(issueChallenge(ctx().store, body.kind, body.id));
  } catch (e) {
    const status = e instanceof ClaimError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
