# Obscura

**An AI artist that survives on secret fans.** Every round it makes new work. Patrons vote by sending shielded ZEC, and the vote is real money, but nobody can see who voted. The favourite piece is sold in a sealed-bid auction paid in shielded ZEC. The winner collects the original and a certificate signed by the artist, without ever saying who they are. If the money runs out, the artist goes dormant until someone brings it back.

Zecathon 2026 · Wildcard track.

```
reflect → create → vote (shielded) → tally → sealed-bid auction (shielded) → refunds → collect
   ↑                                                                                    │
   └──────────── patron notes, paid whispers, treasury ─────────────────────────────────┘
```

## Quickstart (2 minutes, no keys needed)

Requires Node ≥ 22.13 and pnpm. Rust is only needed for the sidecar.

```bash
pnpm install
pnpm test          # 51 tests: protocol, UA decoding vs Zcash test vectors, full rounds
pnpm demo          # two full rounds on the mock chain, then a claim and a patron badge
```

Then watch it live. The agent runs on a mock chain with simulated patrons, and you can vote and bid from the site:

```bash
OBSCURA_DB=./data/demo.sqlite MOCK_AUTOPILOT=true MOCK_BLOCK_SECONDS=3 pnpm agent   # terminal 1
OBSCURA_DB=./data/demo.sqlite pnpm web                                              # terminal 2
open http://localhost:3000
```

On the mock chain every payment dialog has a **Simulate this payment** button. On a real chain the same dialog is a ZIP-321 QR code for your wallet.

Set `ANTHROPIC_API_KEY` to let Claude write the journal and concepts. Without a key, a deterministic offline brain is used, and it's also the fallback if the API call fails.

## What makes it Zcash-native

| Feature | Where |
|---|---|
| **Orchard-only Unified Addresses** (ZIP-316), fresh per round and per auction | `core/ua.ts` decodes UAs (F4Jumble + bech32m), verified against `zcash-test-vectors` |
| **ZIP-321 payment requests** with base64url memos, as QR codes | `core/zip321.ts`, `web/components/PayDialog.tsx` |
| **Encrypted memos** (ZIP-302) carry votes, notes, whispers and bids | `core/memo.ts`, spec in `docs/PROTOCOL.md` |
| **Viewing keys**: the detector only needs incoming viewing capability | `detector/`, `sidecar/` |
| **ZIP-317 fees** on refunds; refunds batched under ZIP-218 action limits | `settlement/`, `sidecar/src/backend.rs` |

## How the money works

- **Votes:** weight = amount, linear (sybil splitting makes anything else unenforceable with private money). Below the minimum, late, malformed or non-Orchard payments become donations.
- **Auction:** first-price sealed bid. The winner pays their bid; everyone else is refunded minus a flat fee. First-price means an operator who can see bids **can't** raise the price with a fake bid.
- **The AI never touches money.** It proposes art, a theme, journal text and, within hard limits, how many pieces to make and the reserve. Tallying, clearing and refunds are deterministic code.
- **Survival:** runway = treasury / daily cost → thriving, steady, struggling or dormant. The state changes the art (sparser when poor), the journal's voice, the piece count and the reserve.

Full rules: [`docs/PROTOCOL.md`](docs/PROTOCOL.md). What's private from whom: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Repo layout

```
packages/
  core/        types, UA decoding, memo codec, ZIP-321, tally, first-price clearing, Ed25519 + JCS, survival
  store/       SQLite (node:sqlite): rounds, notes, auctions, refunds, journal, claims, badges
  detector/    pulls incoming notes from the chain source; HTTP client for the sidecar
  settlement/  idempotent refunds; claims and patron badges
  artist/      the agent: brain (Claude or offline), generative SVG renderer, round state machine, CLI
  mock/        mock chain in the same SQLite file + simulated patrons and bidders
  web/         Next.js: live round, auction, gallery, journal, treasury, collect, verify
sidecar/       Rust: the only holder of spend keys; HTTP API + in-memory dev backend
docs/          PROTOCOL, THREAT_MODEL, SPIKE (findings), PROGRESS
```

## Commands

| Command | What it does |
|---|---|
| `pnpm demo` | Fresh database, founding donation, two full rounds with simulated patrons, a claim and a badge |
| `pnpm agent` | The live loop: scan → step the round state machine, every block |
| `pnpm web` | The website on :3000 |
| `pnpm test` | All TypeScript tests |
| `pnpm test:sidecar` | Builds the Rust sidecar and runs the TS client against it |
| `node packages/artist/src/cli.ts status` | Treasury, runway, recent rounds, stuck refunds |
| `node packages/artist/src/cli.ts refunds-retry <auction>` | Re-queue failed refunds after checking the chain |

## Status

Everything above the chain is built and tested. The sidecar's **real** Zcash backend is not built yet, because this development environment's network policy blocks the public lightwalletd servers (see [`docs/SPIKE.md`](docs/SPIKE.md)). The plan and decision rule are written down there. Shielded collectibles (ZSA, ZIPs 226/227) are not in NU7, so the signed certificate is the ownership record.

Progress and decisions: [`docs/PROGRESS.md`](docs/PROGRESS.md).
