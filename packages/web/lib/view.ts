// Shapes sent from the server to client components. Public data only.
import type { CandidateId, Network, RoundStatus, SurvivalState } from "@obscura/core";

export interface CandidateView {
  id: CandidateId;
  title: string;
  concept: string;
  image: string;
  totalZat: number;
  votes: number;
}

export interface AppState {
  network: Network;
  mock: boolean;
  tip: number;
  artistPubkey: string;
  donationAddress: string | null;
  survival: { state: SurvivalState; runwayDays: number | null; treasuryZat: number };
  minVoteZat: number;
  minWhisperZat: number;
  round: null | {
    id: string;
    status: RoundStatus;
    theme: string | null;
    address: string;
    openHeight: number;
    closeHeight: number;
    reserveZat: number;
    survivalState: SurvivalState;
    winner: CandidateId | null;
    candidates: CandidateView[];
    notes: string[];
    whispers: string[];
    voteCount: number;
    badgeCount: number;
  };
  auction: null | {
    id: string;
    roundId: string;
    candidateId: CandidateId;
    title: string;
    concept: string;
    image: string;
    address: string;
    openHeight: number;
    closeHeight: number;
    reserveZat: number;
    status: "OPEN" | "CLEARED" | "SETTLED";
    priceZat: number | null;
    validBidCount: number | null;
    /** While open: number of payments received (amounts stay hidden). */
    bidsReceived: number | null;
  };
}

export function zec(zat: number, digits = 4): string {
  return (zat / 1e8).toFixed(digits).replace(/\.?0+$/, "") || "0";
}
