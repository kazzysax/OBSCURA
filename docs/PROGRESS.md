# Progress

Deadline: Oct 28, 2026 (Zecathon, Wildcard + Community Choice).

## Must ship
- [x] 0. Scaffold: pnpm workspace, TS config, Vitest, Rust sidecar crate, .gitignore, .env.example, git init
- [ ] 1. Spike: shielded send with memo from code + detect with IVK (decide librustzcash vs zingo-cli)
  - [x] Research: crate versions, NU7 timing, ZSA status (docs/SPIKE.md)
  - [ ] Live testnet send + detect — **blocked here**: the cloud environment's network policy rejects lightwalletd hosts. Run locally or allow the hosts.
- [x] 2. `core`: memo codec (vote/whisper/bid), UA decoding (vs zcash-test-vectors), ZIP-321, tally, first-price clearing + refunds, JCS + signatures, survival, tests
- [x] 3. `mock` + `web`: gallery, live round page with QR codes, live tallies, runway
- [x] 4. `artist`: reflect (results, notes, whispers, survival) → concepts → images → journal; open/close rounds (hard bounds)
- [ ] 5. `detector` on real chain, replacing mock — detector + sidecar HTTP contract done and tested against the Rust dev backend; real backend waits on step 1
- [x] 6. Auction + `settlement` + claim flow (verified end to end in a browser)
- [ ] 7. Full mainnet round end to end (record txids in this file) — needs step 1 and your go-ahead (spends mainnet funds)
- [x] README quickstart

## Should ship
- [x] Patron badges (registry + badge certificate + share-to-X)
- [ ] Per-round voting accounts + published IVK + "verify this round" page
- [x] Patron notes feeding next round's themes

## Nice to have
- [ ] ~~Shielded collectible for the auction winner~~ — not possible before the deadline: ZIPs 226/227 are Draft and not in NU7 (docs/SPIKE.md). Signed certificate is the ownership record.
- [x] Whispers (paid theme suggestions)
- [ ] Agent pays its own compute (NEAR Intents)
- [ ] FROST multi-sig treasury

## Submission
- [ ] Read gated rules (deadline TZ, deliverables, mainnet requirement, team rules)
- [x] docs/THREAT_MODEL.md
- [ ] Demo video (~3 min)
- [ ] X thread + agent posts journal/winners daily during Community Choice

## Mainnet txids
_(none yet)_

## Decisions log
- 2026-10-18: Auction is first-price sealed-bid, not Vickrey. Operator sees bids via IVK and could shill a second-price auction; first-price removes that.
- 2026-10-18: Two accounts (voting, auction) with fresh Orchard-only UAs per round/auction. Auction IVK never published.
- 2026-10-18: Linear vote weight; quadratic is unenforceable with shielded payments (sybil splitting).
- 2026-10-18: Patron badges via optional pubkey in vote memo (replaces ZIP-311 proof of patronage).
- 2026-10-18: Treasury survival states drive agent behaviour; dormant = no new pieces.
- 2026-10-18: Sidecar backend decided by the spike; prefer zingo-cli if it covers send+memo+IVK scan reliably.
- 2026-10-18: No shielded NFT: ZSAs (ZIPs 226/227) are Draft and not part of NU7. Certificate is canonical.
- 2026-10-18: NU7 mainnet target is 2026-11-05 (after the deadline): mainnet stays at 75 s blocks for the submission; testnet is already 25 s.
- 2026-10-18: Store uses Node's built-in `node:sqlite` instead of better-sqlite3 (no native build step). Added a `store` package to the layout.
- 2026-10-18: TypeScript runs directly via Node type stripping (no build step for libraries); no TS parameter properties or enums.
- 2026-10-18: Default image provider is a deterministic generative SVG renderer, so the demo runs with no API keys and image hashes are reproducible. Public previews are watermarked; the clean original is released only through a claim.
- 2026-10-18: Refunds never auto-retry after an ambiguous failure (pending → sending → sent; failed needs `refunds-retry`). A stuck refund beats a double payment.
- 2026-10-18: Claude brain uses `claude-opus-5-5` with structured output and server-side refusal fallback (`fallbacks: "default"`); any error falls back to the offline brain.
