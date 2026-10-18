# Paste this into Claude Code as your first message (from inside the obscura folder)

Read CLAUDE.md, docs/PROTOCOL.md and docs/PROGRESS.md first.

Then do steps 0 and 1 from docs/PROGRESS.md:

**Step 0 — scaffold.** Set up the pnpm monorepo exactly as laid out in CLAUDE.md: root package.json + pnpm-workspace.yaml, shared tsconfig, Vitest, empty packages (core, detector, artist, settlement, web, mock) that build, and a `sidecar/` Rust crate that compiles. `git init` and make the first commit. Don't add Zcash crates yet.

**Step 1 — spike.** Find out what actually works today before writing real code:
1. Check current versions and docs of `zcash_client_backend`, `zcash_client_sqlite` and Zingolib / zingo-cli. Tell me the fastest reliable way to (a) create a wallet, (b) derive a fresh diversified Unified Address with an Orchard receiver, (c) send an Orchard transaction with a memo, (d) detect incoming notes + memos with only a viewing key, (e) derive a separate account per round so its IVK can be published later.
2. Find a working public testnet lightwalletd/Zaino endpoint and confirm it responds.
3. Write the smallest spike that does (b), (c) and (d) on **testnet**. Give me the address to fund from a faucet.
4. Check whether a Zcash shielded asset / collectible standard (e.g. the ZSA work in ZIPs 226/227) is **activated on mainnet today** and usable from the chosen backend and at least one common wallet. Report: status, activation height or expected network upgrade, library/wallet support, and whether a one-of-one token could be issued and sent to the auction winner before Oct 28. If not ready, say so — the signed provenance certificate stays the ownership record.
5. Record findings and the decisions (librustzcash vs zingo-cli; shielded collectible yes/no) in the decisions log in docs/PROGRESS.md.

While the spike waits on funding, start step 2 (`core`) with tests — it doesn't depend on the chain.

Rules: verify APIs from source/docs, don't guess. No keys or seeds in git. Ask me before anything that spends mainnet funds.
