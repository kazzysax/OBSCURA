// The artist's mind: reflect on the last round and propose the next one.
// Its output is creative only. Numbers it proposes are clamped by core's clampDecision, and nothing
// it writes is ever parsed into an amount or address.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { Bounds, SurvivalState } from "@obscura/core";

export const MOTIFS = ["horizon", "orbits", "fog", "grid", "tide", "constellation", "bloom", "fracture"] as const;
export type Motif = (typeof MOTIFS)[number];

const HEX = /^#[0-9a-fA-F]{6}$/;

export const ReflectionSchema = z.object({
  journal_title: z.string().describe("A short title for today's journal entry (max ~8 words)."),
  journal_body: z.string().describe("The journal entry, first person, 80–180 words."),
  theme: z.string().describe("The theme tying this round's pieces together, a few words."),
  whispers_used: z.array(z.string()).describe("The exact text of any patron whispers you chose to follow; empty if none."),
  proposed_pieces: z.number().int().describe("How many pieces you want to make this round."),
  proposed_reserve_zec: z.number().describe("The auction reserve price you want, in ZEC."),
  pieces: z
    .array(
      z.object({
        title: z.string(),
        concept: z.string().describe("Two or three sentences describing the piece."),
        motif: z.enum(MOTIFS),
        palette: z.array(z.string()).describe("3 to 5 colours as #rrggbb hex."),
      }),
    )
    .describe("Candidate pieces, at least as many as proposed_pieces."),
});

export type Reflection = z.infer<typeof ReflectionSchema>;

export interface ReflectContext {
  roundId: string;
  survival: { state: SurvivalState; runwayDays: number; treasuryZec: number };
  bounds: Bounds;
  lastRound: null | {
    roundId: string;
    theme: string | null;
    winnerTitle: string | null;
    winnerConcept: string | null;
    totals: { title: string; zec: number; votes: number }[];
    salePriceZec: number | null;
    validBids: number | null;
  };
  patronNotes: string[];
  /** Ranked by amount paid, highest first. Already passed the content filter. */
  whispers: { text: string; zec: number }[];
  recentThemes: string[];
}

export interface ArtistBrain {
  readonly name: string;
  reflect(ctx: ReflectContext): Promise<Reflection>;
}

const SYSTEM = `You are Obscura, an autonomous artist that lives on Zcash. Patrons keep you alive by paying shielded ZEC to vote for your pieces; the favourite is sold in a sealed-bid auction. You never learn who your patrons are — only what they paid and the notes they chose to send.

Each round you reflect, then propose new pieces. Your survival state colours everything:
- thriving: confident, expansive, generous with ideas.
- steady: focused and curious.
- struggling: sparse, anxious, honest about needing support — never begging, never manipulative.
- dormant: you cannot afford to paint; you only write.

Write the journal in your own voice. Mention which patron whispers you followed or set aside, and why. Never mention specific people, wallets, addresses or amounts paid by any individual; aggregate totals are fine. Never ask anyone for money directly or promise returns. Pieces are abstract generative works; describe them so a viewer can picture them.`;

function describe(ctx: ReflectContext): string {
  const lines = [
    `Round: ${ctx.roundId}`,
    `Survival: ${ctx.survival.state}, treasury ${ctx.survival.treasuryZec.toFixed(4)} ZEC, runway ${Number.isFinite(ctx.survival.runwayDays) ? ctx.survival.runwayDays.toFixed(1) : "unlimited"} days.`,
    `Hard bounds (you may propose within these): pieces ${ctx.bounds.piecesMin}–${ctx.bounds.piecesMax}, reserve ${ctx.bounds.reserveMinZat / 1e8}–${ctx.bounds.reserveMaxZat / 1e8} ZEC.`,
  ];
  if (ctx.lastRound) {
    const lr = ctx.lastRound;
    lines.push(
      `Last round ${lr.roundId} (theme: ${lr.theme ?? "none"}): winner "${lr.winnerTitle ?? "none"}" — ${lr.winnerConcept ?? ""}`,
      `Vote totals: ${lr.totals.map((t) => `"${t.title}" ${t.zec.toFixed(4)} ZEC from ${t.votes} votes`).join("; ") || "no votes"}`,
      `Auction: ${lr.salePriceZec !== null ? `sold for ${lr.salePriceZec} ZEC with ${lr.validBids} sealed bids` : "no sale"}`,
    );
  } else {
    lines.push("This is your first round. Introduce yourself in the journal.");
  }
  lines.push(`Recent themes (avoid repeating): ${ctx.recentThemes.join(", ") || "none"}`);
  lines.push(`Patron notes (anonymous):\n${ctx.patronNotes.map((n) => `- ${n}`).join("\n") || "- none"}`);
  lines.push(`Paid whispers, highest first:\n${ctx.whispers.map((w) => `- "${w.text}" (${w.zec} ZEC)`).join("\n") || "- none"}`);
  return lines.join("\n");
}

/** Keep only usable output; anything malformed is replaced so the round can still run. */
export function sanitiseReflection(r: Reflection, ctx: ReflectContext): Reflection {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const known = new Set(ctx.whispers.map((w) => w.text));
  return {
    journal_title: clip(r.journal_title.trim() || "Untitled", 80),
    journal_body: clip(r.journal_body.trim(), 2000),
    theme: clip(r.theme.trim() || "untitled", 80),
    whispers_used: r.whispers_used.filter((w) => known.has(w)),
    proposed_pieces: r.proposed_pieces,
    proposed_reserve_zec: r.proposed_reserve_zec,
    pieces: r.pieces.map((p) => ({
      title: clip(p.title.trim() || "Untitled", 80),
      concept: clip(p.concept.trim(), 600),
      motif: MOTIFS.includes(p.motif) ? p.motif : "horizon",
      palette: p.palette.filter((c) => HEX.test(c)).slice(0, 5),
    })),
  };
}

export class ClaudeBrain implements ArtistBrain {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async reflect(ctx: ReflectContext): Promise<Reflection> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(ReflectionSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: describe(ctx) }],
    });
    if (response.stop_reason === "refusal") throw new Error(`model declined: ${response.stop_details?.category ?? "unknown"}`);
    if (!response.parsed_output) throw new Error(`no structured output (stop_reason ${response.stop_reason})`);
    return sanitiseReflection(response.parsed_output, ctx);
  }
}

// --- Offline brain: deterministic, no network. Used for tests, demos without a key, and as a fallback.

const TITLES: Record<Motif, string[]> = {
  horizon: ["Last Light Over Nothing", "The Line Holds", "Where the Sea Ends"],
  orbits: ["Quiet Gravity", "Two Bodies, No Names", "Slow Return"],
  fog: ["Lighthouse, Unseen", "Morning Without Edges", "What the Fog Keeps"],
  grid: ["Ledger of Small Things", "Rooms Without Doors", "Census of Light"],
  tide: ["Salt Arithmetic", "Low Water", "The Tide Counts Back"],
  constellation: ["Anonymous Stars", "Map for No One", "Night Census"],
  bloom: ["Garden After Rain", "Unsigned Flowers", "Bloom in the Dark"],
  fracture: ["Fault Line", "Broken Receipt", "Glass Weather"],
};

const PALETTES: Record<SurvivalState, string[][]> = {
  thriving: [["#0b1d3a", "#f4a259", "#f4e285", "#8cb369"], ["#1b263b", "#e0e1dd", "#ff6b6b", "#ffd166"], ["#0d1b2a", "#48cae4", "#ade8f4", "#ffb703"]],
  steady: [["#22223b", "#9a8c98", "#c9ada7", "#f2e9e4"], ["#1d3557", "#457b9d", "#a8dadc", "#f1faee"], ["#283618", "#606c38", "#dda15e", "#fefae0"]],
  struggling: [["#111111", "#3a3a3a", "#7d7d7d", "#c2b280"], ["#0f0f14", "#2b2d42", "#8d99ae", "#edf2f4"]],
  dormant: [["#050505", "#1a1a1a", "#333333"]],
};

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class OfflineBrain implements ArtistBrain {
  readonly name = "offline";

  async reflect(ctx: ReflectContext): Promise<Reflection> {
    const seed = hash(ctx.roundId);
    const top = ctx.whispers[0];
    const theme = top ? top.text : ["salt and distance", "unsigned light", "the arithmetic of tides", "quiet machines"][seed % 4]!;
    const palettes = PALETTES[ctx.survival.state];
    const n = ctx.bounds.piecesMax;
    const pieces = Array.from({ length: n }, (_, i) => {
      const motif = MOTIFS[(seed + i * 3) % MOTIFS.length]!;
      const titles = TITLES[motif];
      return {
        title: titles[(seed + i) % titles.length]!,
        concept: `A ${motif} study on "${theme}". ${ctx.survival.state === "struggling" ? "Drawn with very few marks, as if saving ink." : "Layered and patient, built from many small decisions."}`,
        motif,
        palette: palettes[(seed + i) % palettes.length]!,
      };
    });
    const mood: Record<SurvivalState, string> = {
      thriving: "I have more ideas than walls to hang them on.",
      steady: "The treasury is calm, so I can afford to be curious.",
      struggling: "The treasury is thin. I am drawing with fewer lines and I notice every one.",
      dormant: "I can't afford to paint right now. I'll keep writing until someone lights the lamp again.",
    };
    const last = ctx.lastRound;
    const body = [
      last
        ? `Round ${last.roundId} chose "${last.winnerTitle ?? "nothing"}". ${last.salePriceZec !== null ? `It sold for ${last.salePriceZec} ZEC to someone I will never meet.` : "Nobody bought it, so it stays with me."}`
        : "This is my first entry. I make things, strangers I can't see vote for them with private money, and that money keeps me alive.",
      ctx.patronNotes[0] ? `Someone wrote: "${ctx.patronNotes[0]}". I kept it.` : "",
      top ? `A whisper asked for "${top.text}". I listened.` : "",
      mood[ctx.survival.state],
      `Today I am working on ${theme}.`,
    ]
      .filter(Boolean)
      .join(" ");
    return sanitiseReflection(
      {
        journal_title: last ? `After ${last.roundId}` : "First light",
        journal_body: body,
        theme,
        whispers_used: top ? [top.text] : [],
        proposed_pieces: n,
        proposed_reserve_zec: ctx.bounds.reserveMinZat / 1e8,
        pieces,
      },
      ctx,
    );
  }
}

/** Claude when a key is configured, falling back to the offline brain on any error. */
export class ResilientBrain implements ArtistBrain {
  readonly name: string;
  lastError: string | null = null;

  private readonly primary: ArtistBrain | null;
  private readonly fallback: ArtistBrain;

  constructor(primary: ArtistBrain | null, fallback: ArtistBrain = new OfflineBrain()) {
    this.primary = primary;
    this.fallback = fallback;
    this.name = primary ? `${primary.name}+${fallback.name}` : fallback.name;
  }

  async reflect(ctx: ReflectContext): Promise<Reflection> {
    if (this.primary) {
      try {
        return await this.primary.reflect(ctx);
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    }
    return this.fallback.reflect(ctx);
  }
}
