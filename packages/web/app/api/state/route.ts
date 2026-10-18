import { NextResponse } from "next/server";
import { appState } from "@/lib/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(appState());
}
