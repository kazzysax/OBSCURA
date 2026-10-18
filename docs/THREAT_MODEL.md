# Threat model

Obscura's promise: **you can vote, bid and collect without anyone learning it was you, and the money rules can't be bent by the AI.** This document lists who can see what, what can go wrong, and what we do about it. Where something isn't solved, it says so.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Spend keys (voting, auction accounts) | `sidecar/` only | Can move all funds, including bids held for refund |
| Incoming viewing keys | detector / sidecar | Reveal every amount and memo received |
| Artist signing key (`wallet/artist.key`, 0600) | agent + web server | Signs provenance certificates and badges |
| Patron / claim private keys | the patron's browser + downloaded backup | The only proof of winning or of patronage |
| Patron identities | nowhere, by design | The point of the project |

## What each party can see

| Party | Sees | Never sees |
|---|---|---|
| Public (website) | Pieces, image hashes, live vote totals, filtered notes, whisper texts, number of bids, clearing price, treasury, journal | Who voted or bid, individual losing bid amounts, refund addresses |
| Chain observers | That shielded transactions happened | Amounts, memos, senders, recipients (Orchard) |
| Operator (holds IVKs) | Every received amount and memo, including bids and refund addresses, in real time | Senders. Orchard notes carry no sender address. |
| AI agent | Aggregate totals, filtered notes and whispers, treasury balance | Keys, addresses, individual bids. It can't move money. |

## Threats and mitigations

### 1. Operator shill bidding
*An operator who sees bids could insert a fake bid to raise the price.*
- **Mitigated by design:** the auction is **first-price**. The winner pays their own bid, so a fake bid can't raise anyone's price. The worst a shill can do is "win" the piece back, leaving it unsold.
- Residual: an operator could still fake-win to keep a piece off the market. That costs them nothing but sells nothing, so it hurts only the artist.

### 2. The AI moves or misdirects money
- No LLM output is parsed into an amount or address. Tally (`core/tally.ts`), clearing (`core/auction.ts`) and refunds (`settlement/`) are deterministic and unit-tested.
- The agent's two numeric proposals (piece count, reserve) pass through `clampDecision` against hard bounds from config. A test feeds it absurd values (`round.integration.test.ts`).
- Agent input is filtered (`filterPublicText`): no links, addresses or blocked words reach the prompt or the website. The system prompt forbids naming individuals or soliciting money.

### 3. Prompt injection via notes and whispers
Notes and whispers are attacker-controlled text that reaches the model.
- They're length-limited, stripped of control and bidi characters, and filtered.
- The worst case is a bad journal entry or theme. The model has no tools and no access to money or keys, so injection can't escalate.
- Residual: offensive content that slips the filter could appear in the journal. Mitigation: review step for mainnet (roadmap), a stronger filter.

### 4. Double refunds and lost refunds
- Each refund is keyed by the bid's `(txid, output_index)`; queueing is idempotent.
- Status flow `pending → sending → sent`. A crash mid-send leaves `sending`, which is **never retried automatically**. A failed send becomes `failed` and needs an operator to check the chain and run `refunds-retry`. We accept a stuck refund over a double payment.
- Refunds are batched (`REFUND_BATCH_SIZE`) to stay well under ZIP-218 per-block action limits.

### 5. Hot wallet compromise
- Spend keys exist only in the sidecar, bound to `127.0.0.1`. The TypeScript side has no spend capability.
- Keep the hot balance small; sweep proceeds to cold storage. Roadmap: FROST multi-sig treasury.
- Residual: during an open auction the hot wallet holds every bid. That's inherent to escrowed sealed bids.

### 6. Linking patrons
- Fresh Orchard-only address per round and per auction; addresses are never reused (enforced in the store and the sidecar).
- The optional patron public key in a vote memo is a fresh key per vote; the badge registry publishes keys, not amounts.
- Refund addresses come from the bidder; the UI tells them to use a fresh one.
- Residual: **timing.** Someone who sees you open the site and a payment land seconds later could correlate them. Wallets that delay broadcast help; we don't control that.
- Residual: **amounts.** A distinctive vote amount (e.g. 0.01337 ZEC) is visible to the operator and appears in totals. The UI pre-fills round amounts.
- Residual: **viewing-key publication.** If per-round voting IVKs are published (PROTOCOL §8), vote amounts and notes for that round become public; senders still don't. Auction IVKs are never published.

### 7. Claim theft
- A claim requires a signature over a fresh, single-use, 10-minute challenge with the key from the winning memo. The signature is verified before the challenge is consumed, so a wrong guess can't burn the winner's challenge.
- The claim private key never leaves the browser. Losing it means losing the claim, so the UI downloads a backup automatically when the bid is created.

### 8. Forged certificates
- Certificates and badges are Ed25519 signatures over RFC 8785 canonical JSON, with a `type` field and a separate `obscura:v0:<kind>:` prefix for challenges, so a signature for one purpose can't be replayed for another.
- Verification is public (`/verify`) and pins the artist's public key.

### 9. Chain reorganisations
- Tallies and clearing wait for `close_height + CONFIRMATIONS`. The detector re-scans a few blocks of overlap.
- Residual: a note that disappears in a deep reorg after counting stays in the database. With `CONFIRMATIONS ≥ 3` on mainnet this is negligible.

### 10. Non-Orchard funds
- Addresses are Orchard-only. Anything arriving in another pool is recorded as a rejected donation and not counted.

## Not in scope (yet)
- Denial of service against the website or sidecar.
- A malicious image provider (the default renderer is local and deterministic).
- Legal and tax questions around anonymous art sales.
