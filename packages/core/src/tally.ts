// Deterministic vote tally (docs/PROTOCOL.md §1–2, §5).
import { filterPublicText, parseMemo } from "./memo.ts";
import { compareCanonical, inWindow } from "./order.ts";
import type { CandidateId, IncomingNote, Network, Zat } from "./types.ts";

export interface RoundRules {
  roundId: string;
  candidateIds: readonly CandidateId[];
  openHeight: number;
  closeHeight: number;
  minVoteZat: Zat;
  minWhisperZat: Zat;
  network: Network;
}

export type DonationReason =
  | "below_min_vote"
  | "below_min_whisper"
  | "unknown_candidate"
  | "wrong_round"
  | "malformed_memo"
  | "late"
  | "early"
  | "non_orchard";

export interface CountedVote {
  note: IncomingNote;
  candidateId: CandidateId;
  patronPubkey: string | null;
  /** Patron note after the public filter; null if empty or filtered out. */
  publicNote: string | null;
}

export interface CountedWhisper {
  note: IncomingNote;
  text: string;
}

export interface CandidateTotal {
  candidateId: CandidateId;
  totalZat: Zat;
  votes: number;
  firstVote: IncomingNote | null;
}

export interface TallyResult {
  roundId: string;
  totals: CandidateTotal[];
  winner: CandidateId | null;
  votes: CountedVote[];
  /** Whispers that passed the filter, ranked by amount desc then canonical order. */
  whispers: CountedWhisper[];
  donations: { note: IncomingNote; reason: DonationReason }[];
  /** candidate → sorted unique patron pubkeys from counted votes. */
  badgeRegistry: Record<string, string[]>;
  totalReceivedZat: Zat;
}

export function tallyRound(notes: readonly IncomingNote[], rules: RoundRules): TallyResult {
  const sorted = [...notes].sort(compareCanonical);
  const votes: CountedVote[] = [];
  const whispers: CountedWhisper[] = [];
  const donations: TallyResult["donations"] = [];

  for (const note of sorted) {
    const donate = (reason: DonationReason) => donations.push({ note, reason });
    if (note.pool !== "orchard") {
      donate("non_orchard");
      continue;
    }
    if (note.height < rules.openHeight) {
      donate("early");
      continue;
    }
    if (!inWindow(note.height, rules.openHeight, rules.closeHeight)) {
      donate("late");
      continue;
    }
    const memo = parseMemo(note.memo, rules.network);
    if (memo.kind === "vote") {
      if (memo.roundId !== rules.roundId) donate("wrong_round");
      else if (!rules.candidateIds.includes(memo.candidateId)) donate("unknown_candidate");
      else if (note.valueZat < rules.minVoteZat) donate("below_min_vote");
      else
        votes.push({
          note,
          candidateId: memo.candidateId,
          patronPubkey: memo.patronPubkey,
          publicNote: filterPublicText(memo.note),
        });
    } else if (memo.kind === "whisper") {
      if (memo.roundId !== rules.roundId) donate("wrong_round");
      else if (note.valueZat < rules.minWhisperZat) donate("below_min_whisper");
      else {
        const text = filterPublicText(memo.text);
        // A filtered-out whisper is still paid for; it just isn't shown or used.
        if (text) whispers.push({ note, text });
        else donate("malformed_memo");
      }
    } else {
      donate("malformed_memo");
    }
  }

  const totals: CandidateTotal[] = rules.candidateIds.map((candidateId) => {
    const mine = votes.filter((v) => v.candidateId === candidateId);
    return {
      candidateId,
      totalZat: mine.reduce((s, v) => s + v.note.valueZat, 0),
      votes: mine.length,
      firstVote: mine[0]?.note ?? null, // votes are already in canonical order
    };
  });

  const ranked = totals
    .filter((t) => t.votes > 0)
    .sort((a, b) => b.totalZat - a.totalZat || compareCanonical(a.firstVote!, b.firstVote!));
  const winner = ranked[0]?.candidateId ?? null;

  whispers.sort((a, b) => b.note.valueZat - a.note.valueZat || compareCanonical(a.note, b.note));

  const badgeRegistry: Record<string, string[]> = {};
  for (const id of rules.candidateIds) {
    badgeRegistry[id] = [
      ...new Set(votes.filter((v) => v.candidateId === id && v.patronPubkey).map((v) => v.patronPubkey!)),
    ].sort();
  }

  return {
    roundId: rules.roundId,
    totals,
    winner,
    votes,
    whispers,
    donations,
    badgeRegistry,
    totalReceivedZat: sorted.reduce((s, n) => s + n.valueZat, 0),
  };
}
