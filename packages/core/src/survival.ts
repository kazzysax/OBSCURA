// Treasury survival state and bounded agent decisions (docs/PROTOCOL.md §7).
import type { SurvivalState, Zat } from "./types.ts";

export interface SurvivalInput {
  treasuryZat: Zat;
  dailySpendZat: Zat;
  /** Estimated cost of making one round (compute + images). */
  roundCostZat: Zat;
}

export interface Survival {
  state: SurvivalState;
  runwayDays: number;
}

export function survival({ treasuryZat, dailySpendZat, roundCostZat }: SurvivalInput): Survival {
  const runwayDays = dailySpendZat > 0 ? treasuryZat / dailySpendZat : Infinity;
  let state: SurvivalState;
  if (treasuryZat < roundCostZat) state = "dormant";
  else if (runwayDays > 30) state = "thriving";
  else if (runwayDays >= 7) state = "steady";
  else state = "struggling";
  return { state, runwayDays };
}

export interface Bounds {
  piecesMin: number;
  piecesMax: number;
  reserveMinZat: Zat;
  reserveMaxZat: Zat;
}

export interface AgentDecision {
  pieces: number;
  reserveZat: Zat;
}

/** Suggested defaults per state; the agent may propose others, which are then clamped. */
export function defaultDecision(state: SurvivalState, b: Bounds): AgentDecision {
  const mid = Math.round((b.piecesMin + b.piecesMax) / 2);
  const pieces = { thriving: b.piecesMax, steady: mid, struggling: b.piecesMin, dormant: 0 }[state];
  const reserve = { thriving: b.reserveMinZat, steady: b.reserveMinZat * 2, struggling: b.reserveMinZat * 3, dormant: 0 }[state];
  return clampDecision({ pieces, reserveZat: reserve }, b, state);
}

/**
 * Clamp whatever the agent proposed into the hard bounds. Non-numbers fall back to the bound minimum.
 * Dormant always means no pieces and no auction.
 */
export function clampDecision(proposed: { pieces?: unknown; reserveZat?: unknown }, b: Bounds, state: SurvivalState): AgentDecision {
  if (state === "dormant") return { pieces: 0, reserveZat: 0 };
  const int = (v: unknown, lo: number, hi: number) => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : lo;
    return Math.min(hi, Math.max(lo, n));
  };
  return {
    pieces: int(proposed.pieces, b.piecesMin, Math.min(b.piecesMax, 8)),
    reserveZat: int(proposed.reserveZat, b.reserveMinZat, b.reserveMaxZat),
  };
}
