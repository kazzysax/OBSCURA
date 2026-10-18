# Obscura — an autonomous AI artist with anonymous patrons, on Zcash

Zecathon submission, **Wildcard** track ($15,000) + aiming for **Community Choice** ($5,000). Submissions due **Oct 28, 2026** (check the exact time zone in the Zecathon portal). "Obscura" is a working name.

Wildcard brief: "Art, games, social, hardware. Anything that makes a shielded transaction worth making."

## The idea in one paragraph

An AI artist agent makes new work every round. Patrons vote for their favourite piece by sending shielded ZEC — the vote is real money, but nobody can see who voted. The winning piece is sold in a sealed-bid auction paid in shielded ZEC. Proceeds go to the artist's shielded treasury, which keeps it alive — **if patrons stop paying, the artist goes dormant.** The gallery, vote totals and clearing prices are public; the patrons and collectors are not. Like Botto (the DAO-governed AI artist), but with private patronage.

## Why this wins (keep in mind for every decision)

- Every action is a real **mainnet shielded transaction** with a reason to exist: voting, whispering, bidding, collecting.
- Uses Zcash-native features judges look for: Unified Addresses (ZIP-316), ZIP-321 payment requests (QR codes), encrypted memos (ZIP-302), viewing keys.
- Trust-minimised by design: first-price auction (operator can't shill), deterministic money code, honest threat model.
- Visual and shareable → Community Choice on X: survival story, anonymous patron badges, daily agent posts.
- Distinct from existing Zcash entries: sealForge (human sealed-bid auctions) and the many agent-wallet / x402 / MCP payment projects. Don't drift toward those.

## Core loop (one "round") — full spec in docs/PROTOCOL.md

1. **Reflect:** the agent reads last round's results (tallies, auction price, patron notes, whispers) and its treasury survival state, and writes a short public journal entry.
2. **Create:** it generates N candidate pieces (2–6, default 4) — concept text + image. Skipped when dormant.
3. **Open voting:** a fresh Orchard-only address for the round; each candidate shows a ZIP-321 QR code. A vote = shielded payment; amount = weight (linear); memo = candidate id (+ optional patron pubkey, + optional note).
4. **Close voting:** deterministic tally; top candidate wins. Badge registry published.
5. **Sealed-bid auction (first-price)** for the winner. Bids are shielded payments of the full bid to a fresh auction address; memo carries the bidder's claim key and refund address.
6. **Settle:** winner pays their bid; losing and refundable invalid bids are refunded by shielded tx minus a flat fee. Winner claims the full-resolution file + an artist-signed provenance certificate by signing with their claim key.

Demo compresses a round into minutes; production rounds are daily.

## Agentic behaviour (what makes it an agent, not a script)

- Taste memory: patron notes, whispers and vote results shape the next round's themes.
- Survival: treasury runway sets its state (thriving / steady / struggling / dormant), which changes its tone, style, piece count and reserve.
- Public journal: explains its choices in its own voice, including which whispers it took or ignored.
- **The AI never touches money.** Tallies, auction clearing, refunds and payouts are deterministic code. The agent only proposes art, themes, journal text and (within hard bounds) reserve price / piece count.

## Repo layout (pnpm monorepo, TypeScript + sidecar)

```
packages/
  core/        types, UA decoding, memo codec, ZIP-321 builder, tally, first-price clearing, JCS + Ed25519 signatures, survival + tests
  store/       SQLite via node:sqlite; shared by agent, detector and web
  detector/    scans lightwalletd/Zaino with the IVKs, parses obscura memos, emits vote/whisper/bid events
  artist/      the agent loop: reflect, concept, image generation, journal, round scheduling
  settlement/  computes refunds and asks the sidecar to send them
  web/         Next.js: gallery, live round with QR codes, auction, treasury/runway, journal, claim, badges
  mock/        mock chain that emits fake events (so UI and agent work isn't blocked by Zcash)
sidecar/       Rust HTTP API (tip, new_address, send, scan_incoming, balance); dev backend now, real backend (librustzcash or zingo-cli) after the spike
docs/          PROTOCOL.md, PROGRESS.md, THREAT_MODEL.md, SPIKE.md
```

## Tech choices

| Layer | Primary | Fallback |
|---|---|---|
| Zcash tx build/scan | Whichever the spike proves fastest: `zingo-cli` / Zallet, or Rust on librustzcash (`zcash_client_backend` + `zcash_client_sqlite`) | the other, behind the same sidecar interface |
| Chain data | Public lightwalletd / Zaino endpoint | Own Zebra + Zaino (sync takes a day+) |
| Agent reasoning + journal | Claude API | any LLM behind one interface |
| Image generation | One pluggable provider behind `generateImage()` | pre-rendered set for the demo |
| Signatures | Ed25519 (`@noble/ed25519`), RFC 8785 canonical JSON | — |
| Store | SQLite (`node:sqlite`, built into Node ≥ 22.13) | — |
| Web | Next.js | — |
| Tests | Vitest, `cargo test` | — |

## Rules for working in this repo

- **Verify Zcash APIs, don't guess.** Check crate docs / source for the pinned version. Spike first when unsure.
- **Never commit keys, seeds, viewing keys or API keys.** `.env` is gitignored; keep `.env.example` current.
- **Spend keys only in `sidecar/`.** Detector holds only incoming viewing keys.
- **Two accounts:** `voting` and `auction`. Fresh Orchard-only address per round and per auction; never reuse. Never publish the auction IVK.
- **Orchard only.** Reject transparent / Sapling funds.
- **Deterministic code decides all money movement.** No LLM output is ever parsed into an amount or address.
- Every tie-break ends in canonical order `(height, txid, output index)`.
- Bound every agent decision with hard limits in config (min/max pieces, min/max reserve).
- Build against `packages/mock` first; swap in the real detector when the spike works.
- TypeScript runs via Node type stripping: no parameter properties, no enums (`erasableSyntaxOnly`).
- Small commits; repo builds and tests pass after each. Update `docs/PROGRESS.md` when a step is done.
- Ask before anything that spends mainnet funds.

## Build order (cut from the bottom)

1. Scaffold + **spike**: shielded send with memo from code, detect it with an IVK (decide zingo-cli vs librustzcash). Start Zebra/Zaino sync early only if needed.
2. `core`: memo codec, ZIP-321 builder, tally, first-price clearing + refunds, signatures, survival + tests.
3. `mock` + `web`: gallery, live round page with QR codes, live tallies, runway.
4. `artist`: reflect → concepts → images → journal; opens/closes rounds.
5. `detector` on real chain, replacing mock.
6. Auction + `settlement` + claim flow.
7. One full **mainnet** round end to end; record txids.
8. README, THREAT_MODEL, demo video, X thread.

Must ship: 1–7 + README + survival states. Should ship: patron badges; per-round published voting IVK; patron notes feeding the next round. Nice: winner receives a real shielded collectible (only if a shielded asset standard is live on mainnet — check in the spike; the signed certificate is always the fallback), whispers, agent pays its own compute (e.g. via NEAR Intents), FROST multi-sig treasury.

## References

Zcash developer docs · ZIPs 316, 321, 302, 317, 32 · RFC 8785 · librustzcash · Zingolib · Zebra · Zaino · ZODL (manual testing) · NEAR Intents · Botto (prior art for AI artist + community curation)
