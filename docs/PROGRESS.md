# Progress

Deadline: Oct 28, 2026 (Zecathon, Wildcard + Community Choice).

## Must ship
- [ ] 0. Scaffold: pnpm workspace, TS config, Vitest, Rust sidecar crate, .gitignore, .env.example, git init
- [ ] 1. Spike: shielded send with memo from code + detect with IVK (decide librustzcash vs zingo-cli)
- [ ] 2. `core`: memo codec (vote/whisper/bid), ZIP-321 builder, tally, first-price clearing + refunds, JCS + signatures (claim, provenance, badge), survival state, tests
- [ ] 3. `mock` + `web`: gallery, live round page with QR codes, live tallies, runway
- [ ] 4. `artist`: reflect (results, notes, whispers, survival) → concepts → images → journal; open/close rounds (with hard bounds)
- [ ] 5. `detector` on real chain, replacing mock
- [ ] 6. Auction + `settlement` + claim flow
- [ ] 7. Full mainnet round end to end (record txids in this file)
- [ ] README quickstart

## Should ship
- [ ] Patron badges (registry + badge certificate + share-to-X)
- [ ] Per-round voting accounts + published IVK + "verify this round" page
- [ ] Patron notes feeding next round's themes

## Nice to have
- [ ] Shielded collectible for the auction winner, if a shielded asset standard is live on mainnet (spike decides; fallback: signed certificate)
- [ ] Whispers (paid theme suggestions)
- [ ] Agent pays its own compute (NEAR Intents)
- [ ] FROST multi-sig treasury

## Submission
- [ ] Read gated rules (deadline TZ, deliverables, mainnet requirement, team rules)
- [ ] docs/THREAT_MODEL.md
- [ ] Demo video (~3 min)
- [ ] X thread + agent posts journal/winners daily during Community Choice

## Decisions log
- 2026-10-18: Auction is first-price sealed-bid, not Vickrey. Operator sees bids via IVK and could shill a second-price auction; first-price removes that.
- 2026-10-18: Two accounts (voting, auction) with fresh Orchard-only UAs per round/auction. Auction IVK never published.
- 2026-10-18: Linear vote weight; quadratic is unenforceable with shielded payments (sybil splitting).
- 2026-10-18: Patron badges via optional pubkey in vote memo (replaces ZIP-311 proof of patronage).
- 2026-10-18: Treasury survival states drive agent behaviour; dormant = no new pieces.
- 2026-10-18: Sidecar backend decided by the spike; prefer zingo-cli if it covers send+memo+IVK scan reliably.
